const Transaction = require("../../models/Transaction");
const Dispute = require("../../models/Dispute");
const { getCustomerConfig } = require("../../helpers/settings");
const {
  DISPUTE_ACTIONABLE_STATUSES,
} = require("../../constants/webhook");
const { CHARGEBACK_DEFAULTS } = require("../../constants/customer");
const {
  sendQuietly,
  notifyDisputeDeadline,
} = require("../../helpers/notifications");

const HOUR_MS = 60 * 60 * 1000;

/**
 * How far past the deadline a dispute is still worth an alert.
 *
 * ⚠️ Bounded on purpose. Without it, every dispute we ever lost stays in the
 * query for ever: the status only leaves `ACTIONABLE` when Razorpay sends a
 * decision, and a dispute nobody answered can sit in `OPEN` indefinitely. The
 * sweep would then re-scan a growing pile every hour to find nothing new — the
 * same non-draining shape the refund sweep had.
 *
 * A week is long enough that a holiday cannot hide it, and short enough that the
 * list stays a worklist rather than an archive.
 */
const OVERDUE_GRACE_HOURS = 24 * 7;

/** At most this many per sweep, so one bad week cannot stall the runner. */
const BATCH = 200;

/**
 * Which warning this dispute has earned, given how long is left.
 *
 * Stages are cumulative and monotonic — 0 means "nothing yet", and the last one
 * is always "the deadline has gone". Returning a number rather than a boolean is
 * what lets the counter on the row act as the claim: a stage can only ever be
 * sent once, by whichever instance wins the conditional update.
 *
 * With the default `[72, 24]`:
 *
 *   > 72h left      -> 0   nothing
 *   72h .. 24h      -> 1   WARNING
 *   24h .. 0h       -> 2   CRITICAL
 *   past due        -> 3   CRITICAL, and the money is likely already gone
 */
const stageFor = (hoursLeft, thresholds) => {
  if (hoursLeft <= 0) return thresholds.length + 1;
  let stage = 0;
  for (const threshold of thresholds) {
    if (hoursLeft <= threshold) stage += 1;
  }
  return stage;
};

/**
 * Warn about dispute response deadlines, before they pass.
 *
 * ### Why this job has to exist
 *
 * `disputeRespondBy` was already being written by the webhook and **nothing was
 * reading it**. A dispute deadline that passes is an automatic loss: the bank
 * does not ask twice, Razorpay does not chase, and no error is raised anywhere,
 * because from the system's point of view nothing happened at all. The only way
 * to see one coming was for somebody to open the worklist and read the dates by
 * eye — so one holiday, or one busy week, and the money was gone.
 *
 * ### It alerts and never acts
 *
 * Deliberately, and for the same reason as `sweepStalePayouts`: only a person
 * with access to the Razorpay dashboard can actually file evidence. A job that
 * tried to auto-respond would submit whatever it had, which is worse than
 * submitting nothing — you get one response per dispute.
 *
 * ### One alert per stage, across every instance
 *
 * `disputeAlertsSent` is both the record and the claim. The stage is written in
 * the same conditional update that decides who sends, so two instances sweeping
 * at once cannot both alert, and a re-run cannot repeat a stage.
 *
 * @returns {Promise<{ checked: number, alerted: number, overdue: number }>}
 */
exports.disputeDeadlines = async () => {
  const config = await getCustomerConfig();
  const configured = config.chargeback?.deadlineAlertHours;
  /**
   * Widest first, so `stageFor` counts thresholds in the order they are crossed.
   * Sorted here rather than trusted: an admin who saves `[24, 72]` would
   * otherwise get the 24h warning three days early and the 72h one never.
   */
  const thresholds = [
    ...(Array.isArray(configured) && configured.length
      ? configured
      : CHARGEBACK_DEFAULTS.deadlineAlertHours),
  ]
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);

  const now = Date.now();

  /**
   * ⚠️ Read from `Dispute`, not from `Transaction`.
   *
   * The deadline used to live in a single field on the payment, so a payment
   * with two disputes — a chargeback and the pre-arbitration that follows it —
   * kept only the newest deadline and the first one **stopped existing**. That
   * is the failure this job was written to prevent, hiding inside the job
   * itself.
   */
  const disputes = await Dispute.find({
    status: { $in: DISPUTE_ACTIONABLE_STATUSES },
    respondBy: {
      $ne: null,
      // See OVERDUE_GRACE_HOURS: keeps the sweep draining.
      $gte: new Date(now - OVERDUE_GRACE_HOURS * HOUR_MS),
    },
    isDeleted: false,
  })
    // Soonest deadline first — if the batch is ever capped, it caps on the ones
    // that matter least.
    .sort({ respondBy: 1 })
    .limit(BATCH)
    .lean();

  let alerted = 0;
  let overdue = 0;

  for (const dispute of disputes) {
    const hoursLeft = (new Date(dispute.respondBy).getTime() - now) / HOUR_MS;
    const stage = stageFor(hoursLeft, thresholds);
    const sent = dispute.alertsSent || 0;

    if (stage <= sent) continue;

    /**
     * The claim. Filtering on the value we read is what makes this safe to run
     * on more than one instance: the loser matches nothing and moves on.
     */
    const claimed = await Dispute.findOneAndUpdate(
      { _id: dispute._id, alertsSent: sent },
      { $set: { alertsSent: stage } },
      { returnDocument: "after" },
    ).lean();

    if (!claimed) continue;

    /**
     * The payment, for the claim code and the amount. Read after the claim, so a
     * missing transaction cannot cost the stage — the alert still goes, naming
     * the dispute.
     */
    const transaction = await Transaction.findById(dispute.transactionId)
      .select("razorpayPaymentId voucher amount invoiceId")
      .lean();

    const isOverdue = hoursLeft <= 0;
    if (isOverdue) overdue += 1;

    /**
     * Quietly: the stage is already claimed, and a mail server that is down must
     * not make the job throw and re-run — which would skip the stage entirely,
     * because the counter has moved.
     */
    await sendQuietly(
      () =>
        notifyDisputeDeadline({
          // The shape the notice expects, assembled from both rows.
          transaction: {
            ...(transaction || {}),
            _id: dispute.transactionId,
            disputeId: dispute.disputeId,
            disputeStatus: dispute.status,
            disputeAmount: dispute.amount,
            disputeRespondBy: dispute.respondBy,
          },
          hoursLeft,
          isOverdue,
        }),
      "dispute deadline",
    );
    alerted += 1;
  }

  return { checked: disputes.length, alerted, overdue };
};

exports.stageFor = stageFor;
