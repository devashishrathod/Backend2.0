const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const VoucherUsage = require("../../models/VoucherUsage");
const RefundRequest = require("../../models/RefundRequest");
const { REFUND_STATUS } = require("../../constants");
const {
  VOUCHER_CLAIM_STATUS,
  CLAIM_HISTORY_ACTION,
} = require("../../constants/voucherClaim");
const { REFUND_REQUEST_STATUS } = require("../../constants/refund");
const { postRefundEntries } = require("../ledger");
const { recordClaimHistory } = require("../voucherClaims");
const { sendQuietly, notifyClaimRefunded } = require("../notifications");
const { releaseConsumedPromoOnRefund } = require("../promoCodes");
const { getCustomerConfig } = require("../settings");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Everything that changes when a refund actually lands.
 *
 * One function, called from one place — the `refund.processed` webhook — because
 * the alternative is six call sites that each remember five of the six things.
 *
 * ### Every step is idempotent, because the webhook is redelivered
 *
 * Razorpay resends `refund.processed`. The conditional claim on the request's
 * status decides who does the work, and everything after it is safe to run
 * again: `$max` on the cumulative total, `$set` on the claim, an upsert-shaped
 * usage reversal, and a ledger poster guarded by its own unique index.
 *
 * ### The cumulative total comes from the payment, not from this refund
 *
 * ⚠️ The old handler wrote `$set: { amountRefunded: thisRefundsAmount }`. Two
 * partial refunds and the second overwrote the first — a payment refunded ₹300
 * then ₹200 reported ₹200, and the ₹310 still owed to the vendor was invisible.
 *
 * Razorpay sends the payment entity alongside the refund, and it carries
 * `amount_refunded`: the running total **it** holds. Taking that with `$max`
 * makes the field monotonic and correct under redelivery, out-of-order
 * delivery, and refunds issued by hand in the dashboard — none of which an
 * `$inc` survives.
 *
 * @param {object} args
 * @param {object} args.refundRequest      the request being completed
 * @param {number} [args.gatewayTotalRefunded] `payment.amount_refunded / 100`
 * @param {string} [args.utr]              bank reference from the refund entity
 * @param {object} [args.actor]            who triggered it; a webhook has none
 */
exports.applyRefundCompletion = async ({
  refundRequest,
  gatewayTotalRefunded,
  utr,
  actor = {},
}) => {
  /**
   * The conditional claim. `status` is in the filter, so a redelivered webhook
   * loses here and does no work at all.
   */
  const claimed = await RefundRequest.findOneAndUpdate(
    {
      _id: refundRequest._id,
      status: {
        $in: [
          REFUND_REQUEST_STATUS.PROCESSING,
          // A refund can complete without us ever marking it PROCESSING — an
          // admin issuing one from the Razorpay dashboard, for instance.
          REFUND_REQUEST_STATUS.ADMIN_APPROVED,
          REFUND_REQUEST_STATUS.ADMIN_OVERRIDE,
        ],
      },
    },
    {
      $set: {
        status: REFUND_REQUEST_STATUS.COMPLETED,
        completedAt: new Date(),
        isOpen: false,
        ...(utr ? { utr } : {}),
        failureReason: null,
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!claimed) {
    // Somebody already completed it. That is the redelivery doing its job.
    return { applied: false, reason: "ALREADY_COMPLETED" };
  }

  const [transaction, claim] = await Promise.all([
    Transaction.findById(claimed.transactionId).lean(),
    VoucherClaim.findById(claimed.claimId).lean(),
  ]);

  const split = claimed.split || {};
  const paidAmount = transaction?.paidAmount ?? transaction?.amount ?? 0;

  /**
   * Prefer the gateway's own running total; fall back to adding this refund on.
   *
   * The fallback is only reached when the payment entity was not in the payload,
   * and it is still monotonic because of the `$max` below.
   */
  const cumulative = round2(
    gatewayTotalRefunded !== undefined && gatewayTotalRefunded !== null
      ? gatewayTotalRefunded
      : (transaction?.amountRefunded || 0) + (split.totalRefund || 0),
  );

  const isFullyRefunded = cumulative >= round2(paidAmount) - 0.005;

  await Transaction.updateOne(
    { _id: claimed.transactionId },
    {
      // `$max` and not `$set`: monotonic under redelivery and out-of-order
      // delivery alike. A late duplicate of an earlier, smaller refund cannot
      // walk the total backwards.
      $max: { amountRefunded: cumulative },
      $set: {
        /**
         * ⚠️ `PARTIAL` is the state that did not exist before this phase.
         * Writing `COMPLETED` for a ₹300 refund on an ₹810 payment made the row
         * read as fully refunded: settlement skipped it and the balance still
         * owed to the vendor was invisible.
         */
        refundStatus: isFullyRefunded
          ? REFUND_STATUS.COMPLETED
          : REFUND_STATUS.PARTIAL,
        isRefunded: isFullyRefunded,
        paidRefundAt: new Date(),
        latestRefundRequestId: claimed._id,
        // Stays on. The money is gone; it was never the vendor's to be paid.
        settlementHold: true,
        settlementHoldReason: `Refunded (${claimed._id})`,
      },
    },
  );

  /**
   * The claim only changes state on a **full** refund.
   *
   * A partially refunded claim is still a claim that happened — the customer
   * ate, the outlet served them, and part of the money came back. Marking it
   * `REFUNDED` would erase a sale that mostly took place.
   */
  if (isFullyRefunded && claim) {
    await VoucherClaim.updateOne(
      { _id: claim._id },
      {
        $set: {
          status: VOUCHER_CLAIM_STATUS.REFUNDED,
          refundedAt: new Date(),
          refundAmount: cumulative,
          refundReason: claimed.reason,
          /**
           * ⚠️ The once-per-user slot goes back.
           *
           * Without this the customer is told *"you have already used this
           * offer"* for an offer they paid for and did not get. It is the
           * single most annoying way for this flow to be wrong, and it is
           * invisible from our side.
           */
          holdsUsageSlot: false,
        },
      },
    );

    await VoucherUsage.updateMany(
      { voucherClaimId: claim._id, isReversed: { $ne: true } },
      {
        $set: {
          isReversed: true,
          reversedAt: new Date(),
          reversalReason: `Refunded (${claimed._id})`,
        },
      },
    );

    /**
     * The promo code, only if the setting says so.
     *
     * `refund.releasePromoOnRefund` is `false` by default and that default is
     * the right one for a campaign budget: a customer who claims, refunds, and
     * claims again on the same code has spent our promo money twice for one
     * sale. Switching it on is a decision about being generous, not about
     * correctness.
     *
     * Inside the full-refund branch on purpose — a partial refund leaves the
     * customer holding part of what the promo discounted, so the code was
     * genuinely used.
     */
    const config = await getCustomerConfig();
    if (config.refund?.releasePromoOnRefund) {
      await releaseConsumedPromoOnRefund({
        transactionId: claimed.transactionId,
        reason: `Refunded (${claimed._id})`,
      });
    }
  }

  const ledger = await postRefundEntries({
    transaction,
    claim,
    split,
    refundRequest: claimed,
  });

  await recordClaimHistory({
    claimId: claimed.claimId,
    customerId: claimed.customerId,
    brandId: claimed.brandId,
    transactionId: claimed.transactionId,
    action: CLAIM_HISTORY_ACTION.REFUNDED,
    role: actor.role,
    performedBy: actor.userId,
    performedByRole: actor.role ? undefined : "SYSTEM",
    amount: split.totalRefund,
    fromStatus: claim?.status,
    toStatus: isFullyRefunded ? VOUCHER_CLAIM_STATUS.REFUNDED : claim?.status,
    reason: claimed.reason,
    snapshot: {
      requestId: claimed._id,
      split,
      utr: utr || claimed.utr,
      cumulative,
      isFullyRefunded,
      ledger: { posted: ledger.posted, duplicates: ledger.duplicates },
    },
  });

  /**
   * The one the customer is actually waiting for, and it carries the UTR —
   * the reference they quote to their own bank when the money has not landed.
   */
  if (claim) {
    await sendQuietly(
      () =>
        notifyClaimRefunded({
          claim,
          transaction,
          amount: split.totalRefund,
          reference: utr || claimed.utr,
        }),
      "customer claim refunded",
    );
  }

  return {
    applied: true,
    isFullyRefunded,
    cumulative,
    ledger,
    request: claimed,
  };
};
