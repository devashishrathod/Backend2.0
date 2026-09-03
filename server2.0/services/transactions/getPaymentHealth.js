const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const RefundRequest = require("../../models/RefundRequest");
const Settlement = require("../../models/Settlement");
const PayoutLeg = require("../../models/PayoutLeg");
const {
  TRANSACTION_PURPOSE,
  SETTLEMENT_STAGE,
  PAYMENT_HEALTH_STATUS,
} = require("../../constants/transaction");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");
const { REFUND_REQUEST_STATUS } = require("../../constants/refund");
const {
  SETTLEMENT_STATUS,
  SETTLEMENT_PRE_PAYOUT_STATUSES,
} = require("../../constants/settlement");
const { PAYOUT_TYPE, PAYOUT_LEG_STATUS } = require("../../constants/payout");
const { PAYMENT_STATUS } = require("../../constants");
const { JOB_HEALTH_STATUS } = require("../../constants/job");
const {
  buildTransactionFilter,
  assertMoneyIndexes,
} = require("../../helpers/transactions");
/**
 * ⚠️ Required **inside** the handler, not here, because this closes a cycle.
 *
 * `jobs/index.js` imports the job functions it schedules, and some of those live
 * under `services/transactions` — so `jobs → services/transactions →
 * getPaymentHealth → jobs` is a loop. Node resolves a loop by handing back a
 * **partially built** exports object: whichever module is mid-load contributes
 * nothing, and a destructure at the top of the file captures `undefined` for
 * good. Nothing throws at load; the first call does, or worse, a job is
 * registered with `run: undefined` and simply never runs.
 *
 * That is the shape of the bug that once left `handleGatewaySettlement`
 * unreachable and stopped every settlement in the system, silently. A lazy
 * require costs one cache lookup per call and cannot go wrong: by the time a
 * request is being served, both modules are fully loaded.
 */
const jobsHealth = () => require("../../jobs").getJobsHealth();

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Is the money machinery actually working?
 *
 * Not a liveness probe — the server answering at all proves that. This answers
 * the question an admin has at nine in the morning: **did anything get stuck
 * overnight, and is anything quietly losing money right now?**
 *
 * Three sections, because there are three ways this system fails and they need
 * different responses:
 *
 * | Section | Fails how | What an admin does |
 * |---|---|---|
 * | `jobs` | A safety net stopped running | Restart, or look at `lastError` |
 * | `stuck` | Money is sitting in a state nothing will move it out of | Fix the row |
 * | `indexes` | A uniqueness guarantee is missing or wrong | Run the migration |
 *
 * Every count is a **query, not a cached counter**. A cached number that stops
 * updating is worse than no number: it reads as "zero problems" while the
 * problem grows.
 */
exports.getPaymentHealth = async () => {
  const now = Date.now();
  const claimFilter = buildTransactionFilter({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
  });

  const [
    jobs,
    indexes,
    interruptedSettles,
    stuckAuthorizations,
    stalePendingClaims,
    openDisputes,
    disputesDueSoon,
    unsettledCaptures,
    stuckFailedRefunds,
    stuckProcessingRefunds,
    unattendedEscalations,
    stalledApprovals,
    unheldRefunds,
    frozenHolds,
    unconfirmedPayouts,
    overdueSettlements,
    strandedDrafts,
  ] = await Promise.all([
    jobsHealth(),

    // Reports, never drops. See helpers/transactions/assertMoneyIndexes.js.
    assertMoneyIndexes(),

    /**
     * A capture that claimed the row and then died partway.
     *
     * `settlementStage` exists because the conditional claim is terminal but
     * several writes follow it. `resumeIncompleteSettlements` re-runs them, so a
     * count above zero for long means that job is not working — which is why
     * this sits next to `jobs` rather than in a separate page.
     */
    Transaction.countDocuments({
      ...claimFilter,
      verified: true,
      settlementStage: { $ne: SETTLEMENT_STAGE.COMPLETE },
      isDeleted: false,
    }),

    /**
     * ⚠️ The one that costs real money if ignored.
     *
     * An `authorized` payment that is never captured is auto-refunded by
     * Razorpay after about five days. The customer's money goes back, the claim
     * stays unpaid, and nobody notices until the vendor asks why a sale
     * vanished. `alertStuckAuthorizations` watches for it; this is the number
     * that says whether the watching is working.
     */
    Transaction.countDocuments({
      ...claimFilter,
      status: PAYMENT_STATUS.AUTHORIZED,
      verified: false,
      createdAt: { $lte: new Date(now - HOUR_MS) },
      isDeleted: false,
    }),

    /**
     * A claim holding a usage slot with no payment behind it.
     *
     * The slot is taken when the claim is created, not when it is paid — that is
     * what closes the race. The cost is that an abandoned checkout keeps holding
     * it until `releaseStaleClaimHolds` sweeps. A rising count here means a
     * customer is being told "you have already used this offer" about a claim
     * they abandoned.
     */
    VoucherClaim.countDocuments({
      status: VOUCHER_CLAIM_STATUS.PENDING,
      holdsUsageSlot: true,
      createdAt: { $lte: new Date(now - HOUR_MS) },
      isDeleted: false,
    }),

    Transaction.countDocuments({
      ...claimFilter,
      isDisputed: true,
      disputeResolvedAt: null,
      isDeleted: false,
    }),

    // A dispute has a deadline. Missing it loses the money by default, with no
    // decision ever taken — so "due soon" is a different alarm from "open".
    Transaction.countDocuments({
      ...claimFilter,
      isDisputed: true,
      disputeResolvedAt: null,
      disputeRespondBy: { $lte: new Date(now + 3 * DAY_MS), $gte: new Date(now) },
      isDeleted: false,
    }),

    /**
     * Captured, past the payout window, still not paid out.
     *
     * Counted from a fixed 10 days rather than the configured `delayDays`: this
     * is a floor that should be true under **any** setting, so it keeps meaning
     * something even if somebody sets the delay to 30 by accident.
     */
    Transaction.countDocuments({
      ...claimFilter,
      verified: true,
      settlementId: null,
      settlementHold: { $ne: true },
      createdAt: { $lte: new Date(now - 10 * DAY_MS) },
      isDeleted: false,
    }),

    /**
     * ⚠️ A refund the gateway refused, and nobody has moved since.
     *
     * The customer has been told their money is coming and it is not arriving.
     * Nothing in the system will fix this on its own — `SOURCE` is the only
     * automated path and it has already failed, usually because the instrument
     * cannot accept a refund at all. It needs a person, and until `MANUAL_BANK`
     * exists (S1.5) that person has no button either.
     *
     * The vendor is stuck alongside them: `FAILED` deliberately does **not**
     * release `settlementHold`, because the money is still owed.
     */
    RefundRequest.countDocuments({
      status: REFUND_REQUEST_STATUS.FAILED,
      failedAt: { $lte: new Date(now - DAY_MS) },
      isDeleted: false,
    }),

    /**
     * Sent to Razorpay and never heard about again.
     *
     * `reconcileRefunds` asks the gateway every 30 minutes, so a count that
     * stays above zero means that job is not working — not that a bank is slow.
     */
    RefundRequest.countDocuments({
      status: REFUND_REQUEST_STATUS.PROCESSING,
      initiatedAt: { $lte: new Date(now - 3 * DAY_MS) },
      isDeleted: false,
    }),

    /**
     * The outlet did not answer, and neither did we.
     *
     * Escalation moves a request to an admin; it does not decide it. A customer
     * whose refund sat out a vendor window and is now sitting out ours has been
     * waiting two full windows for anyone at all to look.
     */
    RefundRequest.countDocuments({
      status: REFUND_REQUEST_STATUS.VENDOR_TIMEOUT,
      updatedAt: { $lte: new Date(now - DAY_MS) },
      isDeleted: false,
    }),

    /**
     * Approved by somebody, paid by nobody.
     *
     * ⚠️ Nothing else watches these. `escalateStaleRefunds` only looks at
     * `REQUESTED`; once a vendor says yes the request leaves every sweep's
     * filter and waits for an admin to press pay. If nobody does, it waits for
     * ever — the customer has been told their money is approved and is not
     * getting it, and the vendor's money stays held behind it.
     */
    RefundRequest.countDocuments({
      status: {
        $in: [
          REFUND_REQUEST_STATUS.VENDOR_APPROVED,
          REFUND_REQUEST_STATUS.ADMIN_APPROVED,
          REFUND_REQUEST_STATUS.ADMIN_OVERRIDE,
        ],
      },
      updatedAt: { $lte: new Date(now - DAY_MS) },
      isDeleted: false,
    }),

    /**
     * ⚠️ An open refund whose payment is **not** held.
     *
     * The one that actually moves money the wrong way: settlement pays the
     * vendor for a claim that is about to be refunded, and then the refund has
     * nothing to come out of. The whole "no recovery, no negative balance"
     * guarantee rests on that hold existing.
     *
     * `requestRefund` sets it, but the write is a second round trip after the
     * request is created — a process that dies in between leaves exactly this.
     * `reconcileRefunds` repairs it; this counts what it has not got to yet.
     */
    RefundRequest.aggregate([
      { $match: { isOpen: true, isDeleted: false } },
      {
        $lookup: {
          from: "transactions",
          localField: "transactionId",
          foreignField: "_id",
          as: "payment",
          pipeline: [{ $project: { settlementHold: 1 } }],
        },
      },
      { $unwind: "$payment" },
      { $match: { "payment.settlementHold": { $ne: true } } },
      { $count: "total" },
    ]).then((rows) => rows[0]?.total || 0),

    /**
     * ⚠️ Money frozen by a hold that nothing will ever lift.
     *
     * The exact inverse of `unheldRefunds`, and the more dangerous half. That
     * one finds an open refund whose payment is *not* held — money that might be
     * paid out wrongly, which at least surfaces as a complaint. This finds a
     * payment that **is** held with nothing open behind it: no refund, no live
     * dispute, and not fully refunded. Nobody complains, because nobody knows.
     * The eligibility predicate simply stops matching and the vendor's money
     * leaves every future settlement, silently, for ever.
     *
     * Before the admin release endpoint existed there was no way out of this at
     * all, which is why nothing counted it. Now there is, so it is worth asking.
     *
     * A fully refunded payment is excluded: its hold is correct and permanent.
     */
    Transaction.aggregate([
      {
        $match: {
          ...claimFilter,
          settlementHold: true,
          isRefunded: { $ne: true },
          // Give a just-raised refund time to write its own row.
          updatedAt: { $lte: new Date(now - HOUR_MS) },
          isDeleted: false,
        },
      },
      {
        $lookup: {
          from: RefundRequest.collection.name,
          localField: "_id",
          foreignField: "transactionId",
          as: "openRefunds",
          pipeline: [
            { $match: { isOpen: true, isDeleted: false } },
            { $project: { _id: 1 } },
          ],
        },
      },
      {
        $match: {
          openRefunds: { $size: 0 },
          // A live chargeback is a legitimate reason to hold.
          $or: [
            { isDisputed: { $ne: true } },
            { disputeResolvedAt: { $ne: null } },
          ],
        },
      },
      { $count: "total" },
    ]).then((rows) => rows[0]?.total || 0),

    /**
     * ⚠️ A NEFT that was started and never confirmed.
     *
     * `MANUAL_BANK` has no callback — a person reading their banking screen is
     * the confirmation — so an admin who starts a transfer at 4pm and does not
     * come back leaves the settlement `PROCESSING` for ever. The vendor reads
     * "on its way to your bank" indefinitely, no `PAYOUT` row is booked, and
     * the next cycle skips those rows because they are still claimed.
     *
     * Nothing errors. `sweepStalePayouts` alerts on it, so a count that stays
     * above zero means either that job is not running or nobody is acting on it.
     */
    PayoutLeg.countDocuments({
      payoutType: PAYOUT_TYPE.SETTLEMENT,
      status: PAYOUT_LEG_STATUS.INITIATED,
      initiatedAt: { $lte: new Date(now - DAY_MS) },
      isDeleted: false,
    }),

    /**
     * A vendor who has not been paid for money we collected a week ago.
     *
     * Not the same as the sweep's window, deliberately: that one alerts at
     * `notReceivedAlertHours` so somebody has time to act. By the time a
     * settlement is a week old and still unpaid, the alert has already been sent
     * and ignored.
     */
    Settlement.countDocuments({
      status: {
        $in: [
          ...SETTLEMENT_PRE_PAYOUT_STATUSES,
          SETTLEMENT_STATUS.FAILED,
          SETTLEMENT_STATUS.ON_HOLD,
        ],
      },
      netPayable: { $gt: 0 },
      createdAt: { $lte: new Date(now - 7 * DAY_MS) },
      isDeleted: false,
    }),

    /**
     * An empty `DRAFT` whose key still occupies its period.
     *
     * The build writes the shell before it claims rows, so a crash in between
     * leaves one of these — and the next build then **skips that brand's day**,
     * for ever, because the period's `idempotencyKey` is taken.
     * `sweepAbandonedDrafts` voids them hourly.
     */
    Settlement.countDocuments({
      status: SETTLEMENT_STATUS.DRAFT,
      createdAt: { $lte: new Date(now - 6 * HOUR_MS) },
      isDeleted: false,
    }),
  ]);

  const stuck = {
    interruptedSettles,
    stuckAuthorizations,
    stalePendingClaims,
    openDisputes,
    disputesDueSoon,
    unsettledCaptures,
    stuckFailedRefunds,
    stuckProcessingRefunds,
    unattendedEscalations,
    stalledApprovals,
    unheldRefunds,
    // Held with nothing open behind it — the silent freeze.
    frozenHolds,
    // ---- settlements: the money going the other way ----
    unconfirmedPayouts,
    overdueSettlements,
    strandedDrafts,
  };

  /**
   * One number the dashboard can colour, derived rather than stored.
   *
   * Anything that loses money on a timer is CRITICAL — an uncaptured
   * authorization refunds itself, a missed dispute deadline forfeits. Everything
   * else is ATTENTION: real, but it waits for a human without getting worse.
   */
  const critical =
    jobs.status === JOB_HEALTH_STATUS.CRITICAL ||
    !indexes.ok ||
    stuckAuthorizations > 0 ||
    disputesDueSoon > 0 ||
    /**
     * CRITICAL, alongside the two that lose money on a timer — and for the same
     * reason read the other way round: a customer's money is being held and
     * nothing automated will release it.
     */
    stuckFailedRefunds > 0 ||
    // Money that can still be paid to the wrong side.
    unheldRefunds > 0 ||
    /**
     * CRITICAL for the same reason as `stuckFailedRefunds`: the money has
     * physically moved and the system does not know it. Every hour this
     * stays true is an hour the ledger is wrong about a real transfer, and
     * an hour the vendor's next cycle silently skips those rows.
     */
    unconfirmedPayouts > 0;

  const attention =
    jobs.status === JOB_HEALTH_STATUS.STALE ||
    /**
     * A job that has **never** run is not a fresh install being patient.
     *
     * `startJobs` runs every job once at boot, so `NEVER_RUN` surviving means
     * the runner did not start — and then none of the safety nets below exist
     * either. Without this line a brand-new instance with no job runner at all
     * reports a confident `OK`.
     */
    jobs.status === JOB_HEALTH_STATUS.NEVER_RUN ||
    interruptedSettles > 0 ||
    unsettledCaptures > 0 ||
    stalePendingClaims > 0 ||
    openDisputes > 0 ||
    stuckProcessingRefunds > 0 ||
    unattendedEscalations > 0 ||
    stalledApprovals > 0 ||
    overdueSettlements > 0 ||
    strandedDrafts > 0 ||
    /**
     * ATTENTION rather than CRITICAL: nothing is being lost, it is being
     * withheld — and there is now a button for it
     * (`PATCH /transactions/admin/:id/release-hold`). It still has to be
     * asked about, because the vendor cannot see it and will not ask.
     */
    frozenHolds > 0;

  return {
    status: critical
      ? PAYMENT_HEALTH_STATUS.CRITICAL
      : attention
        ? PAYMENT_HEALTH_STATUS.ATTENTION
        : PAYMENT_HEALTH_STATUS.OK,
    checkedAt: new Date(),
    jobs,
    stuck,
    /**
     * ⚠️ Something outside this build keeps recreating `invoiceId_1` and
     * `razorpayOrderId_1` on the shared cluster — blanket unique indexes that
     * reject the *second* row with no value. In production that rejects every
     * second voucher claim. It is reported at boot, and here, because a boot log
     * scrolls away and this page does not.
     */
    indexes,
  };
};
