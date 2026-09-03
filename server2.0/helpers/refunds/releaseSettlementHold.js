const Transaction = require("../../models/Transaction");
const RefundRequest = require("../../models/RefundRequest");
const { DISPUTE_STATUS } = require("../../constants/webhook");

/**
 * Chargeback outcomes that are a **permanent** reason to hold.
 *
 * ⚠️ "Resolved" is not the same as "settled in our favour". A dispute we lost is
 * resolved and the bank has taken the money back — paying the vendor for it
 * hands out money we no longer have. `CLOSED` is Razorpay's ambiguous terminal
 * state, so it is treated the same way: a person decides, not this function.
 */
const LOSING_DISPUTE_STATUSES = Object.freeze([
  DISPUTE_STATUS.LOST,
  DISPUTE_STATUS.CLOSED,
]);

/**
 * Let a vendor's money back into the settlement run.
 *
 * ### Why this function has to exist at all
 *
 * `settlementHold` goes on the moment a refund is requested, and that one line
 * removes the whole "we already paid the vendor, now claw it back" problem. The
 * cost is the mirror image: **a hold nobody releases keeps that money out of
 * every future settlement, for ever, and silently.** The eligibility predicate
 * simply stops matching. Nothing errors, nothing logs, and the vendor notices
 * weeks later when a figure they were expecting never arrives.
 *
 * So every terminal refund state that means *no money is moving* has to call
 * this — `VENDOR_REJECTED`, `ADMIN_REJECTED`, `CANCELLED`. `FAILED` and
 * `COMPLETED` deliberately do not: after a failure the money still has to go
 * back, and after completion it was never the vendor's to begin with.
 *
 * ### It refuses to release on someone else's behalf
 *
 * Two other things put a hold on the same field, and neither is this function's
 * to lift:
 *
 * | Also holds | Released by |
 * |---|---|
 * | another open refund on the same payment | that refund reaching a terminal state |
 * | a chargeback | an explicit admin action, **never** a webhook |
 *
 * A dispute hold lifted by refund logic would settle money that a bank is in the
 * middle of pulling back. So the release is conditional on both, and says which
 * one stopped it.
 *
 * @param {object} options
 * @param {string} options.transactionId
 * @param {string} [options.exceptRequestId] the request that just closed — it is
 *   about to be terminal, so it must not block its own release
 * @param {string} options.reason  recorded on the row for the audit trail
 * @returns {Promise<{released: boolean, blockedBy?: string}>}
 */
exports.releaseSettlementHold = async ({
  transactionId,
  exceptRequestId,
  reason = "Refund closed",
  /**
   * ⚠️ Only the admin release endpoint passes this, and only with a written
   * reason. It is the "explicit admin action" the dispute webhook's comment
   * promises — nothing automated may set it.
   */
  allowDisputed = false,
}) => {
  const transaction = await Transaction.findById(transactionId)
    .select("isDisputed disputeResolvedAt disputeStatus settlementHold")
    .lean();

  if (!transaction) return { released: false, blockedBy: "MISSING" };
  if (!transaction.settlementHold) return { released: false, blockedBy: "NOT_HELD" };

  /**
   * A chargeback outranks everything here.
   *
   * Two separate conditions, and the second one was missing:
   *
   *  - **still open** — `disputeResolvedAt` rather than `isDisputed`, because
   *    Razorpay's dispute events are not monotonic and a late
   *    `payment.dispute.lost` after a `won` would flip a boolean back. The
   *    resolution timestamp only ever goes one way.
   *  - **resolved against us** — a lost chargeback is *resolved*, so the first
   *    condition passes and the hold used to come off. The bank has taken that
   *    money back; settling it pays the vendor from money we no longer hold.
   *    Reachable through the ordinary refund path: reject a refund on a payment
   *    that lost a chargeback, and the rejection released the hold.
   */
  const disputeBlocks =
    (transaction.isDisputed && !transaction.disputeResolvedAt) ||
    LOSING_DISPUTE_STATUSES.includes(transaction.disputeStatus);

  if (disputeBlocks && !allowDisputed) {
    return { released: false, blockedBy: "DISPUTE" };
  }

  const otherOpen = await RefundRequest.countDocuments({
    transactionId,
    isOpen: true,
    isDeleted: false,
    ...(exceptRequestId ? { _id: { $ne: exceptRequestId } } : {}),
  });

  if (otherOpen > 0) return { released: false, blockedBy: "OTHER_REFUND" };

  await Transaction.updateOne(
    { _id: transactionId },
    {
      $set: {
        settlementHold: false,
        settlementHoldReason: null,
        settlementHoldReleasedAt: new Date(),
        settlementHoldReleaseReason: reason,
      },
    },
  );

  return { released: true };
};
