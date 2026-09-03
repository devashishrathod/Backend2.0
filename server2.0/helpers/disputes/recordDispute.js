const Dispute = require("../../models/Dispute");
const { DISPUTE_STATUS } = require("../../constants/webhook");

const DUPLICATE_KEY = 11000;

/** Terminal states — the bank has decided. */
const RESOLVED = [
  DISPUTE_STATUS.WON,
  DISPUTE_STATUS.LOST,
  DISPUTE_STATUS.CLOSED,
];

/**
 * Write one dispute event onto its own row.
 *
 * ### ⚠️ Out-of-order delivery is the whole difficulty
 *
 * Razorpay redelivers dispute webhooks and does **not** guarantee order — a late
 * `lost` can arrive after a `won`. Blindly writing whatever turns up would flip
 * a dispute we had already won into one we lost, and `claimChargebackAdjustments`
 * would then take that money off the vendor for a loss that never happened.
 *
 * So the event's own timestamp decides. An update is applied only when its event
 * is **not older** than the one already recorded; equal is allowed, so a plain
 * redelivery of the same event stays idempotent instead of being refused.
 *
 * The condition lives in the update's filter rather than in an `if`, so two
 * webhook deliveries racing cannot both pass a read and then both write.
 *
 * @param {object} args
 * @param {object} args.transaction  the disputed payment
 * @param {object} args.dispute      Razorpay's dispute entity
 * @param {string} args.status       the status this event puts it in
 * @param {Date}   [args.eventAt]    when the gateway raised it
 * @returns {Promise<{ dispute: object|null, applied: boolean, reason?: string }>}
 */
exports.recordDispute = async ({
  transaction,
  dispute = {},
  status,
  eventAt,
}) => {
  const disputeId = dispute.id;
  if (!disputeId || !status) {
    return { dispute: null, applied: false, reason: "NO_DISPUTE_ID" };
  }

  const at = eventAt instanceof Date ? eventAt : new Date();
  const isResolved = RESOLVED.includes(status);

  const fields = {
    transactionId: transaction?._id,
    brandId: transaction?.brandId,
    customerId: transaction?.customerId,
    status,
    amount: (Number(dispute.amount) || 0) / 100,
    reasonCode: dispute.reason_code,
    reason: dispute.reason,
    phase: dispute.phase,
    lastEventAt: at,
    ...(dispute.respond_by
      ? { respondBy: new Date(dispute.respond_by * 1000) }
      : {}),
    ...(status === DISPUTE_STATUS.OPEN ? { openedAt: at } : {}),
    ...(isResolved ? { resolvedAt: at } : {}),
  };

  /**
   * The row may not exist yet — `payment.dispute.created` is usually first, but
   * a redelivery or a missed event means it is not guaranteed to be. Upsert, and
   * let the unique index on `disputeId` settle a race between two deliveries.
   */
  try {
    const applied = await Dispute.findOneAndUpdate(
      {
        disputeId,
        // Not older than what is on file. `$exists: false` covers the first write.
        $or: [{ lastEventAt: { $lte: at } }, { lastEventAt: null }],
      },
      { $set: fields, $setOnInsert: { disputeId } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    ).lean();

    return { dispute: applied, applied: true };
  } catch (error) {
    if (error?.code !== DUPLICATE_KEY) throw error;

    /**
     * The upsert lost, which here means one of two things: another delivery
     * inserted the row in the same instant, or the row exists with a **newer**
     * event and the filter therefore did not match it.
     *
     * Both are correct outcomes, and neither is an error — hand back what is on
     * file so the caller can carry on with the current truth.
     */
    const current = await Dispute.findOne({ disputeId }).lean();
    return { dispute: current, applied: false, reason: "STALE_OR_RACED" };
  }
};

/**
 * Everything the `Transaction` needs to carry for listing and filtering.
 *
 * ⚠️ A **denormalised copy**, not the record. `Dispute` is the record. This is
 * what a worklist filters on and what a detail screen shows without a join, and
 * it deliberately reflects the *live* picture rather than the last event:
 * `isDisputed` is "any dispute is still open", which is not the same as "the
 * most recent event was an open one".
 */
exports.summariseDisputes = async (transactionId) => {
  const disputes = await Dispute.find({ transactionId, isDeleted: false })
    .sort({ lastEventAt: -1, createdAt: -1 })
    .lean();

  if (!disputes.length) return null;

  const open = disputes.filter((d) => !RESOLVED.includes(d.status));
  // The newest by event time — what a screen shows when it shows "the dispute".
  const latest = disputes[0];

  return {
    isDisputed: open.length > 0,
    disputeStatus: latest.status,
    disputeId: latest.disputeId,
    disputeAmount: latest.amount || undefined,
    disputeReason: latest.reasonCode || latest.reason,
    disputePhase: latest.phase,
    /**
     * ⚠️ The **soonest** deadline still open, not the latest dispute's.
     *
     * With an escalation running beside the original, the one that matters is
     * whichever runs out first — and a screen showing the other would be showing
     * a date nobody needs to act on yet.
     */
    disputeRespondBy:
      open
        .map((d) => d.respondBy)
        .filter(Boolean)
        .sort((a, b) => new Date(a) - new Date(b))[0] || undefined,
    disputedAt: disputes[disputes.length - 1]?.openedAt,
    disputeResolvedAt: open.length ? undefined : latest.resolvedAt,
    disputeCount: disputes.length,
  };
};
