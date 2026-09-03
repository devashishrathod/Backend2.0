const VoucherClaim = require("../../models/VoucherClaim");
const Transaction = require("../../models/Transaction");
const RefundRequest = require("../../models/RefundRequest");
const { throwError } = require("../../utils");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const { VOUCHER_CLAIM_STATUS, CLAIM_HISTORY_ACTION } = require("../../constants/voucherClaim");
const {
  REFUND_REQUEST_STATUS,
  REFUND_REASON,
  REFUND_OPEN_STATUSES,
  REFUND_CUSTOMER_LABEL,
} = require("../../constants/refund");
const { DUPLICATE_KEY } = require("../../constants/mongo");

/** Half a paisa. Money comparisons here are floats, and floats drift. */
const PAISA = 0.005;
const { buildTransactionFilter } = require("../../helpers/transactions");
const { resolveCustomerId } = require("../../helpers/customers");
const { getCustomerConfig } = require("../../helpers/settings");
const {
  calculateRefundSplit,
  assertRefundAllowance,
} = require("../../helpers/refunds");
const { recordClaimHistory } = require("../../helpers/voucherClaims");
const { taintSettlement } = require("../../helpers/settlements");
const {
  sendQuietly,
  notifyVendorRefundRequested,
  notifyCustomerRefundRequested,
} = require("../../helpers/notifications");

const HOUR_MS = 60 * 60 * 1000;

/**
 * Claim states a refund can still be asked for.
 *
 * `REDEEMED` is on the list and has to be: in Phase 1 capture goes straight to
 * `REDEEMED`, so every paid claim is redeemed the moment it is paid. Leaving it
 * off would mean nobody could ever ask for a refund at all.
 */
const REFUNDABLE_CLAIM_STATUSES = [
  VOUCHER_CLAIM_STATUS.PAID,
  VOUCHER_CLAIM_STATUS.REDEEMED,
];

/**
 * The customer asks for their money back.
 *
 * ### The order of operations is the design
 *
 * ```
 * eligibility → freeze the split → create the request → hold the settlement
 * ```
 *
 * The **request is created before the hold**, because the request is the record
 * and the hold is derived from it. The unique index on `(transactionId, isOpen)`
 * is what settles a double tap — not the read-then-write check above it, which
 * two concurrent requests both pass.
 *
 * A hold that fails to land is recoverable and visible: `getPaymentHealth`
 * counts open requests, and a settlement cannot reach this money for another two
 * days anyway. The golden rule guarantees that —
 * `settlementDelayHours >= windowHours + vendorApprovalHours + adminBufferHours`
 * (60h against T+3's 72h) — which is why a refund can never chase money that has
 * already gone out.
 *
 * ### The split is frozen here, not at execution
 *
 * A refund approved on Tuesday and paid on Thursday must move exactly what
 * everyone agreed to on Tuesday. Recomputing at execution would let a promo rule
 * change in between, and the vendor would be docked an amount nobody approved.
 */
exports.requestRefund = async (actor, payload = {}) => {
  const customerId = resolveCustomerId(actor);
  if (!customerId) throwError(403, "Please log in to request a refund.");

  const { claimId, amount, reason, reasonNote } = payload;

  const claim = await VoucherClaim.findOne({
    _id: claimId,
    isDeleted: false,
  }).lean();
  if (!claim) throwError(404, "Claim not found.");

  // Ownership on the **customer**, not the user. Two customers sharing one login
  // must not be able to refund each other's claims.
  if (String(claim.customerId) !== String(customerId)) {
    throwError(403, "You are not authorized to refund this claim.");
  }

  if (!REFUNDABLE_CLAIM_STATUSES.includes(claim.status)) {
    /**
     * The status is named back. "This claim cannot be refunded" leaves a
     * customer with nothing to do; "this claim was cancelled" tells them why and
     * what to ask support about.
     */
    throwError(
      422,
      `This claim is ${String(claim.status).toLowerCase()} and cannot be refunded.`,
    );
  }

  const transaction = await Transaction.findOne({
    ...buildTransactionFilter({ purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM }),
    _id: claim.transactionId,
    isDeleted: false,
  }).lean();

  if (!transaction || !transaction.verified) {
    throwError(422, "This claim has no confirmed payment to refund.");
  }

  const config = await getCustomerConfig();
  const refundConfig = config.refund || {};

  /**
   * Checked before anything is written, and before the window is even looked at.
   *
   * A customer over their allowance should be told that, not told their claim is
   * too old — the first is something support can fix, the second sends them
   * looking for a problem that is not there.
   */
  await assertRefundAllowance({
    customerId,
    config: refundConfig,
    // This payment's own open request is handled idempotently below, not
    // refused here.
    exceptTransactionId: transaction._id,
  });

  // ---------------- the window ----------------
  /**
   * Measured from when the money was taken, not from when the claim was created.
   *
   * A checkout abandoned for an hour and then paid would otherwise start its
   * refund window before the customer had paid anything.
   */
  const paidAt = claim.paidAt || transaction.verifiedAt || transaction.createdAt;
  const windowHours = Number(refundConfig.windowHours) || 0;
  const deadline = new Date(new Date(paidAt).getTime() + windowHours * HOUR_MS);

  if (windowHours > 0 && Date.now() > deadline.getTime()) {
    throwError(
      422,
      `Refunds can be requested within ${windowHours} hours of payment. This one was paid on ${new Date(
        paidAt,
      ).toDateString()}.`,
    );
  }

  // ---------------- how much ----------------
  const paidAmount = transaction.paidAmount ?? transaction.amount;
  const alreadyRefunded = transaction.amountRefunded || 0;

  /**
   * No amount means all of it. Most customers want the whole thing back, and
   * making them restate a figure the server already knows is a way to get it
   * typed wrong.
   */
  const requestedAmount =
    amount === undefined || amount === null
      ? Math.round((paidAmount - alreadyRefunded) * 100) / 100
      : Math.round(Number(amount) * 100) / 100;

  /**
   * ⚠️ Rounded, and compared with a paisa of slack.
   *
   * `paidAmount - alreadyRefunded` is raw float arithmetic:
   * `811.8 - 300` is `511.80000000000007`. A customer asking for exactly the
   * ₹511.80 they had left was told *"partial refunds are not available"* — and
   * since that is the whole remaining balance, there was no larger amount they
   * could ask for instead. Permanently locked out of their own money by a
   * seventh decimal place.
   */
  const remaining = Math.round((paidAmount - alreadyRefunded) * 100) / 100;

  if (!refundConfig.allowPartial && requestedAmount < remaining - PAISA) {
    throwError(
      422,
      `Partial refunds are not available. Please request the full ${remaining.toFixed(2)}.`,
    );
  }

  // Throws on anything unrefundable — over the ceiling, zero, already returned.
  const split = calculateRefundSplit({
    pricing: claim.pricing,
    paidAmount,
    requestedAmount,
    alreadyRefunded,
    gatewayFee: transaction.gatewayFee || 0,
  });

  if (reason === REFUND_REASON.OTHER && !String(reasonNote || "").trim()) {
    throwError(422, "Please tell us what went wrong.");
  }

  // ---------------- the request ----------------
  const vendorApprovalHours = Number(refundConfig.vendorApprovalHours) || 0;

  let request;
  try {
    request = await RefundRequest.create({
      claimId: claim._id,
      transactionId: transaction._id,
      customerId,
      brandId: claim.brandId,
      subBrandId: claim.subBrandId,
      claimCode: claim.claimCode,
      requestedAmount: split.totalRefund,
      split,
      reason,
      reasonNote,
      method: refundConfig.method,
      status: REFUND_REQUEST_STATUS.REQUESTED,
      /**
       * Stored, not computed at read time. The escalation job indexes on it, and
       * raising the setting tomorrow must not silently extend every request
       * already waiting on today's promise.
       */
      vendorRespondBy: new Date(Date.now() + vendorApprovalHours * HOUR_MS),
    });
  } catch (error) {
    if (error?.code === DUPLICATE_KEY) {
      /**
       * Someone else already holds it — a second tap, or a refreshed page. Hand
       * back the request that won rather than an error the customer cannot act
       * on: from their side the outcome is identical, they have asked once.
       */
      const existing = await RefundRequest.findOne({
        transactionId: transaction._id,
        isOpen: true,
      }).lean();

      if (existing) {
        /**
         * The open request wins, and the customer is told **which** amount won.
         *
         * ⚠️ Handing this back is right and stays right: one refund may be open
         * per payment, and for a double tap or a refreshed page the outcome is
         * genuinely identical — "a retry is not a new decision".
         *
         * What was missing is the case where the second ask is a *different*
         * amount. Somebody with a ₹810 refund pending who then asks for ₹100 was
         * handed the ₹810 request with nothing to distinguish it from their own
         * request succeeding. They have no way to know their second ask went
         * nowhere, so they wait for a figure that was never going to come.
         *
         * `askedFor` is set only when the two differ, so the client can say
         * *"you already have ₹810 in progress"* rather than silently showing a
         * number the customer did not type.
         */
        const asked = Math.round(requestedAmount * 100) / 100;
        const open = Math.round((existing.requestedAmount ?? 0) * 100) / 100;

        return present(existing, {
          reused: true,
          ...(Math.abs(asked - open) > PAISA ? { askedFor: asked } : {}),
        });
      }
    }
    throw error;
  }

  // ---------------- hold the money ----------------
  /**
   * ⚠️ This is the one line that removes the whole "we already paid the vendor,
   * now claw it back" problem. The row drops out of every settlement until the
   * refund reaches a terminal state — and `REFUND_HOLD_RELEASING_STATUSES` is
   * what puts it back.
   */
  await Transaction.updateOne(
    { _id: transaction._id },
    {
      $set: {
        settlementHold: true,
        settlementHoldReason: `Refund requested (${request._id})`,
        latestRefundRequestId: request._id,
      },
    },
  );

  /**
   * ⚠️ The hold above only stops a **future** claim.
   *
   * If this payment is already inside a settlement — and between the 02:00 build
   * and a 14:00 payout it very well may be — setting `settlementHold` changes
   * nothing about that settlement. So the settlement is flagged too, and
   * approval refuses while the flag is set.
   */
  await taintSettlement({
    transaction,
    reason: `Refund requested (${request._id})`,
  });

  // Append-only, and failure-tolerant: losing an audit row must never undo a
  // refund request the customer has already been told about.
  await recordClaimHistory({
    claimId: claim._id,
    customerId,
    brandId: claim.brandId,
    transactionId: transaction._id,
    action: CLAIM_HISTORY_ACTION.REFUND_REQUESTED,
    role: actor.role,
    performedBy: actor.userId,
    amount: split.totalRefund,
    reason: reasonNote || reason,
    snapshot: { split, reason, requestId: request._id },
  });

  const saved = request.toObject();

  /**
   * The vendor first — they are the one with a clock running. Both go through
   * `sendQuietly`: the request exists, the hold is on, and the customer has
   * already been told it worked. A mail server being down must not undo that.
   */
  await sendQuietly(
    () => notifyVendorRefundRequested({ request: saved, claim }),
    "vendor refund requested",
  );
  await sendQuietly(
    () => notifyCustomerRefundRequested({ request: saved }),
    "customer refund requested",
  );

  return present(saved, { reused: false });
};

/**
 * What the customer is handed back.
 *
 * The internal vocabulary stays internal — `VENDOR_TIMEOUT` in particular must
 * never reach them. Telling a customer the outlet ignored their request starts a
 * fight the platform then has to referee, and it is not something they can act
 * on.
 */
const present = (request, { reused, askedFor } = {}) => ({
  _id: request._id,
  claimCode: request.claimCode,
  amount: request.requestedAmount,
  status: request.status,
  statusLabel: REFUND_CUSTOMER_LABEL[request.status],
  reason: request.reason,
  requestedAt: request.createdAt,
  // What they should expect next, in the only terms that matter to them.
  isOpen: REFUND_OPEN_STATUSES.includes(request.status),
  reused,
  /**
   * Only present when a retry asked for a **different** amount than the request
   * that is already open. Its absence means the two matched, so the client can
   * treat `reused` alone as an ordinary double-tap.
   */
  ...(askedFor === undefined ? {} : { askedFor }),
});

exports.REFUNDABLE_CLAIM_STATUSES = REFUNDABLE_CLAIM_STATUSES;
