const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const RefundRequest = require("../../models/RefundRequest");
const {
  TRANSACTION_PURPOSE,
  SETTLEMENT_STAGE,
  PAYMENT_HEALTH_STATUS,
} = require("../../constants/transaction");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");
const { REFUND_REQUEST_STATUS } = require("../../constants/refund");
const { PAYMENT_STATUS } = require("../../constants");
const { JOB_HEALTH_STATUS } = require("../../constants/job");
const {
  buildTransactionFilter,
  assertMoneyIndexes,
} = require("../../helpers/transactions");
const { getJobsHealth } = require("../../jobs");

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
  ] = await Promise.all([
    getJobsHealth(),

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
    stuckFailedRefunds > 0;

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
    unattendedEscalations > 0;

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
