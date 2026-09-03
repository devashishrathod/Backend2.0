const RefundRequest = require("../../models/RefundRequest");
const VoucherClaim = require("../../models/VoucherClaim");
const { throwError } = require("../../utils");
const { ROLES } = require("../../constants");
const { CLAIM_HISTORY_ACTION } = require("../../constants/voucherClaim");
const {
  REFUND_REQUEST_STATUS,
  REFUND_CUSTOMER_LABEL,
  REFUND_OPEN_STATUSES,
} = require("../../constants/refund");
const {
  calculateRefundSplit,
  releaseSettlementHold,
} = require("../../helpers/refunds");
const { recordClaimHistory } = require("../../helpers/voucherClaims");
const {
  sendQuietly,
  notifyCustomerRefundApproved,
  notifyCustomerRefundRejected,
} = require("../../helpers/notifications");
const { resolveCustomerId } = require("../../helpers/customers");
const Transaction = require("../../models/Transaction");

/**
 * The only states a vendor may still act on.
 *
 * Not `VENDOR_TIMEOUT`: once the window has run out the request belongs to an
 * admin, and letting the vendor reach back in would mean two people deciding the
 * same thing — with the customer's answer depending on who clicked last.
 */
const VENDOR_CAN_DECIDE = [REFUND_REQUEST_STATUS.REQUESTED];

const loadForBrand = async (actor, requestId) => {
  const request = await RefundRequest.findOne({
    _id: requestId,
    isDeleted: false,
  }).lean();
  if (!request) throwError(404, "Refund request not found.");

  const isBrandSide =
    actor.role === ROLES.VENDOR || actor.role === ROLES.SUB_VENDOR;
  if (
    !isBrandSide ||
    !actor.brandId ||
    String(request.brandId) !== String(actor.brandId)
  ) {
    throwError(403, "You are not authorized to decide this refund.");
  }

  /**
   * An outlet manager decides only what happened at their counter.
   *
   * `assertClaimAccess` applies the same rule to reading a claim; a decision is
   * the stronger action, so it cannot be looser.
   */
  if (
    actor.role === ROLES.SUB_VENDOR &&
    actor.subBrandId &&
    request.subBrandId &&
    String(request.subBrandId) !== String(actor.subBrandId)
  ) {
    throwError(403, "This refund is for a claim made at a different outlet.");
  }

  return request;
};

/**
 * The vendor approves — in full, or for less.
 *
 * ### The amount may go down, never up
 *
 * *"Half the order was fine, the starter was not"* is a real answer, and lowering
 * the amount is how a vendor gives it. Raising it is not an approval of what the
 * customer asked for — it is a new decision, and a fat-fingered extra zero at
 * this step would pay out ten times the claim to somebody who never asked for it.
 *
 * ### The split is recomputed, and re-frozen
 *
 * Frozen at **this** amount, not at the one requested. Everything downstream —
 * the vendor's clawback, our promo reversal, the ledger — reads this block and
 * must describe the money that is actually going to move.
 */
exports.approveRefundAsVendor = async (actor, requestId, payload = {}) => {
  const request = await loadForBrand(actor, requestId);
  assertDecidable(request);

  const approvedAmount =
    payload.approvedAmount === undefined || payload.approvedAmount === null
      ? request.requestedAmount
      : Number(payload.approvedAmount);

  if (approvedAmount > request.requestedAmount + 0.005) {
    throwError(
      422,
      `The customer asked for ₹${request.requestedAmount.toFixed(
        2,
      )}. You can approve that or less, not more.`,
    );
  }

  const { claim, transaction } = await loadContext(request);

  const split = calculateRefundSplit({
    pricing: claim.pricing,
    paidAmount: transaction.paidAmount ?? transaction.amount,
    requestedAmount: approvedAmount,
    alreadyRefunded: transaction.amountRefunded || 0,
    gatewayFee: transaction.gatewayFee || 0,
  });

  /**
   * The conditional claim — `status` is part of the filter.
   *
   * An owner and an outlet manager can be looking at the same request. Without
   * this, both clicks land and the second silently overwrites the first, so the
   * customer's answer depends on who happened to be slower.
   */
  const updated = await RefundRequest.findOneAndUpdate(
    { _id: request._id, status: { $in: VENDOR_CAN_DECIDE } },
    {
      $set: {
        status: REFUND_REQUEST_STATUS.VENDOR_APPROVED,
        approvedAmount: split.totalRefund,
        split,
        vendorDecisionBy: actor.userId,
        vendorDecisionAt: new Date(),
        vendorNote: payload.note,
        // Derived by the pre-save hook on a document save; this is an update, so
        // it is set explicitly. VENDOR_APPROVED is an open state.
        isOpen: true,
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!updated) throwError(409, await alreadyDecided(request));

  await recordClaimHistory({
    claimId: request.claimId,
    customerId: request.customerId,
    brandId: request.brandId,
    transactionId: request.transactionId,
    action: CLAIM_HISTORY_ACTION.REFUND_APPROVED,
    role: actor.role,
    performedBy: actor.userId,
    amount: split.totalRefund,
    reason: payload.note,
    snapshot: {
      split,
      requestId: request._id,
      requestedAmount: request.requestedAmount,
    },
  });

  /**
   * ⚠️ The customer is told here, and was not being told anywhere.
   *
   * This file imported `notifyCustomerRefundApproved` and never called it. The
   * admin path skipped its own notice on the stated belief that "the vendor's
   * approval already told the customer their money is coming" — it had not. So
   * on the **normal** path, the one almost every refund takes, the customer
   * raised a request and then heard nothing at all until the money appeared
   * days later, if they noticed.
   */
  await sendQuietly(
    () => notifyCustomerRefundApproved({ request: updated }),
    "customer refund approved (vendor)",
  );

  return present(updated);
};

/**
 * The vendor says no.
 *
 * A note is required. It is the only thing an admin has to review when the
 * customer disputes the refusal, and *"rejected"* on its own turns every appeal
 * into a phone call.
 *
 * The settlement hold comes **off** here — this is the state that would
 * otherwise strand the vendor's own money in a hold nobody ever lifts.
 */
exports.rejectRefundAsVendor = async (actor, requestId, payload = {}) => {
  const request = await loadForBrand(actor, requestId);
  assertDecidable(request);

  const note = String(payload.note || "").trim();
  if (!note) throwError(422, "Please say why you are declining this refund.");

  const updated = await RefundRequest.findOneAndUpdate(
    { _id: request._id, status: { $in: VENDOR_CAN_DECIDE } },
    {
      $set: {
        status: REFUND_REQUEST_STATUS.VENDOR_REJECTED,
        vendorDecisionBy: actor.userId,
        vendorDecisionAt: new Date(),
        vendorNote: note,
        isOpen: false,
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!updated) throwError(409, await alreadyDecided(request));

  const release = await releaseSettlementHold({
    transactionId: request.transactionId,
    exceptRequestId: request._id,
    reason: "Refund declined by the outlet",
  });

  await recordClaimHistory({
    claimId: request.claimId,
    customerId: request.customerId,
    brandId: request.brandId,
    transactionId: request.transactionId,
    action: CLAIM_HISTORY_ACTION.REFUND_REJECTED,
    role: actor.role,
    performedBy: actor.userId,
    reason: note,
    snapshot: {
      requestId: request._id,
      holdReleased: release.released,
      blockedBy: release.blockedBy,
    },
  });

  /**
   * ⚠️ A decline is the message that matters most, and it was never sent.
   *
   * A customer whose refund is refused and who hears nothing does not conclude
   * "declined" — they conclude the request went nowhere, and they raise another
   * one, or they call. `notifyCustomerRefundRejected` renders
   * `REFUND_CUSTOMER_LABEL`, never the vendor's written note: that note is
   * staff-to-staff, and *"customer collected the order in full"* is not a
   * sentence to show the customer it is about.
   */
  await sendQuietly(
    () => notifyCustomerRefundRejected({ request: updated }),
    "customer refund rejected (vendor)",
  );

  return present(updated);
};

/**
 * The customer withdraws their own request.
 *
 * Allowed while nobody has started paying it out. Once it is `PROCESSING` the
 * money is already with Razorpay and there is nothing to withdraw — saying so
 * is better than accepting a cancellation that will not happen.
 */
exports.cancelRefund = async (actor, requestId) => {
  const customerId = resolveCustomerId(actor);
  if (!customerId) throwError(403, "Please log in to manage your refunds.");

  const request = await RefundRequest.findOne({
    _id: requestId,
    isDeleted: false,
  }).lean();
  if (!request) throwError(404, "Refund request not found.");

  if (String(request.customerId) !== String(customerId)) {
    throwError(403, "You are not authorized to cancel this refund.");
  }

  const CANCELLABLE = [
    REFUND_REQUEST_STATUS.REQUESTED,
    REFUND_REQUEST_STATUS.VENDOR_APPROVED,
    REFUND_REQUEST_STATUS.VENDOR_TIMEOUT,
  ];

  const updated = await RefundRequest.findOneAndUpdate(
    { _id: request._id, status: { $in: CANCELLABLE } },
    {
      $set: {
        status: REFUND_REQUEST_STATUS.CANCELLED,
        isOpen: false,
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!updated) {
    throwError(
      409,
      `This refund is already ${String(request.status)
        .toLowerCase()
        .replace(/_/g, " ")} and cannot be withdrawn.`,
    );
  }

  const release = await releaseSettlementHold({
    transactionId: request.transactionId,
    exceptRequestId: request._id,
    reason: "Refund withdrawn by the customer",
  });

  await recordClaimHistory({
    claimId: request.claimId,
    customerId: request.customerId,
    brandId: request.brandId,
    transactionId: request.transactionId,
    action: CLAIM_HISTORY_ACTION.REFUND_CANCELLED,
    role: actor.role,
    performedBy: actor.userId,
    snapshot: { requestId: request._id, holdReleased: release.released },
  });

  return present(updated);
};

// ---------------------------------------------------------------------------

const assertDecidable = (request) => {
  if (!VENDOR_CAN_DECIDE.includes(request.status)) {
    throwError(409, describeStatus(request.status));
  }
};

/**
 * Says what happened to it, not just that it failed.
 *
 * A vendor whose click lost a race needs to know whether their colleague
 * approved it or the clock ran out — those lead to different next actions.
 */
/**
 * What to tell whoever lost the conditional-claim race.
 *
 * ⚠️ Re-reads the row. It used to report `request.status` — the value read
 * **before** the claim — which is by definition a status that was still
 * decidable. So the outlet manager who lost by a second was told
 *
 *     "This refund has already been decided (requested)."
 *
 * which says nothing and reads as a bug. The entire point of this message is to
 * name what it was decided *to*, so the loser knows whether to argue, wait, or
 * do nothing.
 *
 * Falls back to the stale value if the re-read fails: a worse message is better
 * than a second error on top of the first.
 */
/**
 * The message for a status we already hold.
 *
 * Used by the pre-flight check, where the row was just loaded and its status is
 * genuinely current — there is no race to re-read for, and the check is
 * synchronous.
 */
const describeStatus = (status) => {
  const readable = String(status).toLowerCase().replace(/_/g, " ");
  return status === REFUND_REQUEST_STATUS.VENDOR_TIMEOUT
    ? "This refund has already gone to Trydood for review."
    : `This refund has already been decided — it is now ${readable}.`;
};

const alreadyDecided = async (request) => {
  const fresh = await RefundRequest.findById(request._id)
    .select("status")
    .lean()
    .catch(() => null);

  return describeStatus(fresh?.status || request.status);
};

const loadContext = async (request) => {
  const [claim, transaction] = await Promise.all([
    VoucherClaim.findById(request.claimId).lean(),
    Transaction.findById(request.transactionId).lean(),
  ]);

  if (!claim || !transaction) {
    throwError(422, "The claim behind this refund is missing.");
  }
  return { claim, transaction };
};

/**
 * The brand side sees the real state; the customer-facing label rides along so
 * one shape serves both surfaces.
 */
const present = (request) => ({
  _id: request._id,
  claimCode: request.claimCode,
  status: request.status,
  statusLabel: REFUND_CUSTOMER_LABEL[request.status],
  requestedAmount: request.requestedAmount,
  approvedAmount: request.approvedAmount,
  vendorNote: request.vendorNote,
  decidedAt: request.vendorDecisionAt,
  isOpen: REFUND_OPEN_STATUSES.includes(request.status),
});

exports.VENDOR_CAN_DECIDE = VENDOR_CAN_DECIDE;
