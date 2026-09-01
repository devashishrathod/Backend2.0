const RefundRequest = require("../../models/RefundRequest");
const Transaction = require("../../models/Transaction");
const { throwError } = require("../../utils");
const { ROLES } = require("../../constants");
const { CLAIM_HISTORY_ACTION } = require("../../constants/voucherClaim");
const {
  REFUND_REQUEST_STATUS,
  REFUND_CUSTOMER_LABEL,
  REFUND_OPEN_STATUSES,
} = require("../../constants/refund");
const { REFUND_METHODS } = require("../../constants/customer");
const { getRazorpayAccount } = require("../../configs/razorpay");
const { releaseSettlementHold } = require("../../helpers/refunds");
const { recordClaimHistory } = require("../../helpers/voucherClaims");
const {
  sendQuietly,
  notifyCustomerRefundApproved,
  notifyCustomerRefundRejected,
  notifyAdminRefundFailed,
} = require("../../helpers/notifications");

/**
 * States an admin may still decide on.
 *
 * `VENDOR_APPROVED` is the normal path — the vendor said yes and the admin is
 * only executing. The other two are the exception route: the vendor said no, or
 * never answered, and the admin is overriding. That distinction is kept because
 * a rising override rate does not mean admins are being generous, it means
 * something upstream is wrong — an outlet that never responds, or a voucher
 * that cannot be honoured.
 */
const ADMIN_CAN_DECIDE = [
  REFUND_REQUEST_STATUS.VENDOR_APPROVED,
  REFUND_REQUEST_STATUS.VENDOR_REJECTED,
  REFUND_REQUEST_STATUS.VENDOR_TIMEOUT,
];

const OVERRIDE_FROM = [
  REFUND_REQUEST_STATUS.VENDOR_REJECTED,
  REFUND_REQUEST_STATUS.VENDOR_TIMEOUT,
];

const assertAdmin = (actor) => {
  if (actor?.role !== ROLES.ADMIN) {
    throwError(403, "Only an admin can act on this refund.");
  }
};

const load = async (requestId) => {
  const request = await RefundRequest.findOne({
    _id: requestId,
    isDeleted: false,
  }).lean();
  if (!request) throwError(404, "Refund request not found.");
  return request;
};

/**
 * The admin clears a refund for payment.
 *
 * On the normal path this is not a second gate — the vendor already decided, and
 * the admin is confirming the money can go. Overriding a vendor's `no` (or their
 * silence) needs a written reason, and is flagged so it can be counted.
 */
exports.approveRefundAsAdmin = async (actor, requestId, payload = {}) => {
  assertAdmin(actor);
  const request = await load(requestId);

  if (!ADMIN_CAN_DECIDE.includes(request.status)) {
    throwError(409, `This refund is ${readable(request.status)} and cannot be approved.`);
  }

  const isOverride = OVERRIDE_FROM.includes(request.status);
  const overrideReason = String(payload.overrideReason || "").trim();

  if (isOverride && !overrideReason) {
    throwError(
      422,
      request.status === REFUND_REQUEST_STATUS.VENDOR_REJECTED
        ? "The outlet declined this refund. Say why you are overriding them."
        : "The outlet did not respond. Say why you are approving this yourself.",
    );
  }

  const updated = await RefundRequest.findOneAndUpdate(
    { _id: request._id, status: { $in: ADMIN_CAN_DECIDE } },
    {
      $set: {
        status: isOverride
          ? REFUND_REQUEST_STATUS.ADMIN_OVERRIDE
          : REFUND_REQUEST_STATUS.ADMIN_APPROVED,
        adminDecisionBy: actor.userId,
        adminDecisionAt: new Date(),
        adminNote: payload.note,
        isOverride,
        overrideReason: isOverride ? overrideReason : undefined,
        isOpen: true,
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!updated) throwError(409, "This refund was decided by someone else first.");

  await recordClaimHistory({
    claimId: request.claimId,
    customerId: request.customerId,
    brandId: request.brandId,
    transactionId: request.transactionId,
    action: CLAIM_HISTORY_ACTION.REFUND_APPROVED,
    role: actor.role,
    performedBy: actor.userId,
    amount: updated.approvedAmount ?? updated.requestedAmount,
    reason: overrideReason || payload.note,
    snapshot: { requestId: request._id, isOverride, from: request.status },
  });

  /**
   * Only on an **override**. On the normal path the vendor's approval already
   * told the customer their money is coming, and a second "approved" message an
   * hour later reads as a second refund.
   */
  if (isOverride) {
    await sendQuietly(
      () => notifyCustomerRefundApproved({ request: updated }),
      "customer refund approved (override)",
    );
  }

  return present(updated);
};

/** The admin refuses it, and the vendor's money goes back into the run. */
exports.rejectRefundAsAdmin = async (actor, requestId, payload = {}) => {
  assertAdmin(actor);
  const request = await load(requestId);

  const note = String(payload.note || "").trim();
  if (!note) throwError(422, "Please say why you are declining this refund.");

  if (!ADMIN_CAN_DECIDE.includes(request.status)) {
    throwError(409, `This refund is ${readable(request.status)} and cannot be declined.`);
  }

  const updated = await RefundRequest.findOneAndUpdate(
    { _id: request._id, status: { $in: ADMIN_CAN_DECIDE } },
    {
      $set: {
        status: REFUND_REQUEST_STATUS.ADMIN_REJECTED,
        adminDecisionBy: actor.userId,
        adminDecisionAt: new Date(),
        adminNote: note,
        isOpen: false,
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!updated) throwError(409, "This refund was decided by someone else first.");

  await releaseSettlementHold({
    transactionId: request.transactionId,
    exceptRequestId: request._id,
    reason: "Refund declined after review",
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
    snapshot: { requestId: request._id },
  });

  await sendQuietly(
    () => notifyCustomerRefundRejected({ request: updated }),
    "customer refund rejected by admin",
  );

  return present(updated);
};

/**
 * Send the money.
 *
 * ### The order of operations is the whole safety story
 *
 * ```
 * mark PROCESSING and bump attemptCount  ← written BEFORE the gateway call
 *   → ask Razorpay what already exists   ← only on a retry
 *   → payments.refund()                  ← the step with no undo
 *   → store the refund id
 * ```
 *
 * The counter is incremented **before** the call, not after, and that ordering
 * is what makes a crash survivable. If the process dies between the call
 * succeeding and the id being stored, the row says `PROCESSING` with
 * `attemptCount: 1` and no `razorpayRefundId` — and the next attempt knows to
 * **ask Razorpay** rather than issue a second refund. Incrementing afterwards
 * would leave the counter at zero and the retry would send the money twice.
 *
 * Money out is the one operation with no undo, so nothing is written after it
 * that the next run could not recover on its own.
 */
exports.executeRefund = async (actor, requestId) => {
  assertAdmin(actor);
  const request = await load(requestId);

  const READY = [
    REFUND_REQUEST_STATUS.ADMIN_APPROVED,
    REFUND_REQUEST_STATUS.ADMIN_OVERRIDE,
    // A previous attempt failed. The money still has to go back, and this is
    // where an admin retries from.
    REFUND_REQUEST_STATUS.FAILED,
    // A crash mid-flight leaves this. The Razorpay lookup below sorts it out.
    REFUND_REQUEST_STATUS.PROCESSING,
  ];

  if (!READY.includes(request.status)) {
    throwError(409, `This refund is ${readable(request.status)} and cannot be paid yet.`);
  }

  if (request.method !== REFUND_METHODS.SOURCE) {
    throwError(
      422,
      "This refund is set to be paid to a bank account, which is not automated yet.",
    );
  }

  const transaction = await Transaction.findById(request.transactionId).lean();
  if (!transaction?.razorpayPaymentId) {
    throwError(422, "The payment behind this refund has no Razorpay id to refund against.");
  }

  const amount = request.approvedAmount ?? request.requestedAmount;

  // The claim, and the counter, before anything leaves.
  const claimed = await RefundRequest.findOneAndUpdate(
    { _id: request._id, status: { $in: READY } },
    {
      $set: {
        status: REFUND_REQUEST_STATUS.PROCESSING,
        initiatedAt: new Date(),
        isOpen: true,
      },
      $inc: { attemptCount: 1 },
    },
    { returnDocument: "after" },
  ).lean();

  if (!claimed) throwError(409, "This refund is already being paid.");

  /**
   * The account comes from the **transaction**, never from a constant here.
   *
   * Two separate Razorpay merchants with different secrets: refunding a
   * customer voucher claim through the vendor merchant's client fails with an
   * error that reads like a missing payment rather than a wrong account.
   */
  const { instance } = getRazorpayAccount(transaction.gatewayAccount);

  // ---------------- the crash-recovery path ----------------
  if (claimed.attemptCount > 1) {
    const existing = await findOurRefund(instance, transaction.razorpayPaymentId, request._id);
    if (existing) {
      // A previous attempt did reach Razorpay. Adopt it — issuing another would
      // send the customer their money twice.
      return adopt(request, existing, actor, { recovered: true });
    }
  }

  let refund;
  try {
    refund = await instance.payments.refund(transaction.razorpayPaymentId, {
      amount: Math.round(amount * 100),
      speed: "normal",
      // Stamped so the recovery lookup above can tell our refund from one
      // somebody issued by hand in the Razorpay dashboard.
      notes: {
        refundRequestId: String(request._id),
        claimCode: request.claimCode || "",
      },
    });
  } catch (error) {
    const reason = error?.error?.description || error?.message || "Refund failed";

    await RefundRequest.updateOne(
      { _id: request._id },
      {
        $set: {
          status: REFUND_REQUEST_STATUS.FAILED,
          failedAt: new Date(),
          failureReason: reason.slice(0, 500),
          // Still open: the money has not gone back, and this is what an admin
          // retries from. The settlement hold stays on for the same reason.
          isOpen: true,
        },
      },
    );

    await recordClaimHistory({
      claimId: request.claimId,
      customerId: request.customerId,
      brandId: request.brandId,
      transactionId: request.transactionId,
      action: CLAIM_HISTORY_ACTION.REFUND_FAILED,
      role: actor.role,
      performedBy: actor.userId,
      reason,
      snapshot: { requestId: request._id, attempt: claimed.attemptCount },
    });

    /**
     * ⚠️ CRITICAL, and to an admin. A failed refund is a customer who has been
     * told their money is coming and is not getting it — and nothing else in
     * the system will fix it. Only a person retrying, or switching to a bank
     * transfer, moves it forward.
     */
    await sendQuietly(
      () => notifyAdminRefundFailed({ request: claimed, reason }),
      "admin refund failed",
    );

    throwError(422, `Razorpay could not process this refund: ${reason}`);
  }

  return adopt(request, refund, actor, { recovered: false });
};

/**
 * Ask Razorpay what it already has for this payment.
 *
 * Matched on the note we stamped, not on amount: two partial refunds of the same
 * value are indistinguishable by amount, and adopting the wrong one would leave
 * a real refund untracked.
 */
const findOurRefund = async (instance, paymentId, requestId) => {
  try {
    const result = await instance.payments.fetchMultipleRefund(paymentId);
    const items = result?.items || [];
    return items.find(
      (r) => String(r?.notes?.refundRequestId || "") === String(requestId),
    );
  } catch (error) {
    /**
     * A lookup failure must not become a second refund.
     *
     * Returning `undefined` here would send the money again. Throwing leaves the
     * row `PROCESSING` for a human or the reconcile job, which is the safe way
     * to be wrong.
     */
    throwError(
      503,
      "Could not check Razorpay for an existing refund. Left as processing — try again shortly.",
    );
  }
};

/** Record a Razorpay refund against the request, whether new or recovered. */
const adopt = async (request, refund, actor, { recovered }) => {
  const updated = await RefundRequest.findOneAndUpdate(
    { _id: request._id },
    {
      $set: {
        razorpayRefundId: refund.id,
        // Razorpay puts the bank reference here. The customer quotes it to their
        // bank, so it is the one field support actually needs.
        utr: refund?.acquirer_data?.arn || null,
        speed: refund.speed_processed || refund.speed_requested || null,
        status: REFUND_REQUEST_STATUS.PROCESSING,
        isOpen: true,
        failureReason: null,
      },
    },
    { returnDocument: "after" },
  ).lean();

  await Transaction.updateOne(
    { _id: request.transactionId },
    { $set: { latestRefundRequestId: request._id } },
  );

  return { ...present(updated), recovered };
};

const readable = (status) =>
  String(status).toLowerCase().replace(/_/g, " ");

const present = (request) => ({
  _id: request._id,
  claimCode: request.claimCode,
  status: request.status,
  statusLabel: REFUND_CUSTOMER_LABEL[request.status],
  amount: request.approvedAmount ?? request.requestedAmount,
  razorpayRefundId: request.razorpayRefundId,
  utr: request.utr,
  isOverride: request.isOverride,
  attemptCount: request.attemptCount,
  isOpen: REFUND_OPEN_STATUSES.includes(request.status),
});

exports.ADMIN_CAN_DECIDE = ADMIN_CAN_DECIDE;
exports.OVERRIDE_FROM = OVERRIDE_FROM;
