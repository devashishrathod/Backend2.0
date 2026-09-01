const Transaction = require("../../models/Transaction");
const RefundRequest = require("../../models/RefundRequest");

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
}) => {
  const transaction = await Transaction.findById(transactionId)
    .select("isDisputed disputeResolvedAt settlementHold")
    .lean();

  if (!transaction) return { released: false, blockedBy: "MISSING" };
  if (!transaction.settlementHold) return { released: false, blockedBy: "NOT_HELD" };

  /**
   * A chargeback outranks everything here.
   *
   * `disputeResolvedAt` rather than `isDisputed`: Razorpay's dispute events are
   * not monotonic, and `payment.dispute.lost` arriving after a `won` would flip
   * a boolean back. The resolution timestamp only ever goes one way.
   */
  if (transaction.isDisputed && !transaction.disputeResolvedAt) {
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
