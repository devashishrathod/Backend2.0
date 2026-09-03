const {
  expireSubscriptions,
  sendExpiryReminders,
} = require("../services/subscribeds");
const { expireVouchers } = require("../services/vouchers");
const {
  releaseStalePromoReservations,
} = require("../helpers/promoCodes");
const {
  releaseStaleClaimHolds,
  resumeIncompleteSettlements,
  reconcileClaimPayments,
  alertStuckAuthorizations,
} = require("../services/voucherClaims");
const {
  escalateStaleRefunds,
  reconcileRefunds,
  remindVendorsAboutRefunds,
  remindCustomersAboutBankDetails,
} = require("../services/refunds");
const {
  buildSettlements,
  sweepStalePayouts,
  sweepStrandedClaims,
  alertLateSettlements,
  reconcileSettlementLedger,
  sweepAbandonedDrafts,
  alertVendorDebt,
} = require("../services/settlements");
const {
  disputeDeadlines,
  reapShadowIndexesJob,
} = require("../services/transactions");
const { getSubscriptionConfig } = require("../helpers/settings");
const {
  acquireJobLock,
  releaseJobLock,
  startJobLockHeartbeat,
  getJobHealth,
  INSTANCE_ID,
} = require("../helpers/jobs");
const { JOB_SKIP_REASON, JOB_HEALTH_STATUS } = require("../constants/job");

/**
 * Minimal background job runner.
 *
 * Deliberately dependency-free (`setInterval`, no cron library): the only thing
 * needed here is "run this every N minutes, and once on boot", and adding a
 * scheduling dependency for that is not worth it.
 *
 * Each job is wrapped so that:
 *  - a throw is logged and swallowed — one bad run must not kill the interval,
 *  - runs cannot overlap **in this process** — `inFlight`,
 *  - runs cannot overlap **across processes** — `JobLock`.
 *
 * ### Why the cross-process lock exists
 *
 * This is an in-process timer, so two instances (a PM2 cluster, two dynos) means
 * every job runs twice — and on boot, immediately and simultaneously. Most of
 * these sweeps are idempotent so nothing corrupts, but they race each other and
 * double-hit external APIs, and the money-side jobs this design adds later are
 * not all so forgiving.
 *
 * ### Why the health record exists
 *
 * The failure that costs the most is not a job that throws — that gets logged.
 * It is `ENABLE_JOBS=false` left set after a debugging session, or a process
 * down for hours. Nothing errors; the safety nets simply stop, and it surfaces
 * as money stuck somewhere days later. Every run writes its outcome to the same
 * `JobLock` row, so "nothing has run since Tuesday" is a question that can be
 * asked.
 *
 * Correctness never depends on this running. `getActiveSubscription` expires a
 * lapsed plan on read, so a stopped runner delays cleanup rather than letting a
 * vendor keep paid features.
 */

const DEFAULT_INTERVAL_MINUTES = 60;
const MINUTE_MS = 60 * 1000;

const registry = [
  {
    name: "expireSubscriptions",
    run: expireSubscriptions,
    // Admin-configurable via Setting.vendor.subscription.
    intervalMinutes: async () => {
      const config = await getSubscriptionConfig();
      return config.expiryJobIntervalMinutes || DEFAULT_INTERVAL_MINUTES;
    },
  },
  {
    // Also recounts the affected brands' voucher usage, since expiring a
    // voucher frees a slot in the plan's voucher pool.
    name: "expireVouchers",
    run: expireVouchers,
    intervalMinutes: () => DEFAULT_INTERVAL_MINUTES,
  },
  {
    name: "sendExpiryReminders",
    run: sendExpiryReminders,
    intervalMinutes: async () => {
      const config = await getSubscriptionConfig();
      return config.reminderJobIntervalMinutes || 180;
    },
  },
  {
    // Reclaims promo-code holds from checkouts that were never completed, so a
    // single-use code is not locked forever by an abandoned order.
    name: "releaseStalePromoReservations",
    run: releaseStalePromoReservations,
    intervalMinutes: () => 15,
  },

  // ---------------- voucher claims ----------------
  {
    // The once-per-user twin of the promo sweep. Asks Razorpay before it
    // cancels anything — see the service.
    name: "releaseStaleClaimHolds",
    run: releaseStaleClaimHolds,
    intervalMinutes: () => 15,
  },
  {
    /**
     * The repair path for a settlement that was claimed and then abandoned.
     *
     * The most important job here: without it a crash mid-settle leaves a
     * customer charged, a vendor uncredited, and no way back in.
     */
    name: "resumeIncompleteSettlements",
    run: resumeIncompleteSettlements,
    intervalMinutes: () => 15,
  },
  {
    // Payments the gateway took that neither the webhook nor the browser told
    // us about.
    name: "reconcileClaimPayments",
    run: reconcileClaimPayments,
    intervalMinutes: () => 30,
  },
  {
    // Money the bank is holding that nobody has taken. If this ever fires,
    // auto-capture is off and every payment is in the same state.
    name: "alertStuckAuthorizations",
    run: alertStuckAuthorizations,
    intervalMinutes: () => 30,
  },

  // ---------------- refunds ----------------
  {
    /**
     * A silent outlet cannot hold a customer's money. After
     * `refund.vendorApprovalHours` the request stops being theirs.
     */
    name: "escalateStaleRefunds",
    run: escalateStaleRefunds,
    intervalMinutes: () => 15,
  },
  {
    /**
     * Refunds that left for Razorpay and never came back.
     *
     * A lost `refund.processed` leaves the customer with their money, the claim
     * still redeemed, the once-per-user slot still held and no ledger row. This
     * asks Razorpay rather than waiting — and **reads only**: issuing a refund
     * is `executeRefund`'s job, and a reconcile that could pay would be a
     * second, unguarded path to money leaving.
     */
    name: "reconcileRefunds",
    run: reconcileRefunds,
    intervalMinutes: () => 30,
  },
  {
    // Two nudges before the window closes, so a timeout is never a surprise.
    name: "remindVendorsAboutRefunds",
    run: remindVendorsAboutRefunds,
    intervalMinutes: () => 60,
  },
  {
    /**
     * ⚠️ `AWAITING_BANK_DETAILS` was the one open refund state with nothing
     * watching it.
     *
     * Two nudges to the customer, then the row is handed to an admin — because
     * the cost of a silent customer falls on the **vendor**: `settlementHold`
     * keeps that payment out of every settlement until somebody acts, and
     * nothing was ever going to.
     */
    name: "remindCustomersAboutBankDetails",
    run: remindCustomersAboutBankDetails,
    intervalMinutes: () => 60,
  },

  // ---------------- settlements ----------------
  //
  // Every other money path here fails loudly. A settlement fails by *not
  // happening* — no build, an unconfirmed NEFT, a payout that booked no ledger
  // row — and an absence has to be looked for. That is what these four do.
  {
    /**
     * Build yesterday's payouts.
     *
     * Hourly rather than nightly on purpose: `buildSettlements` is idempotent on
     * `idempotencyKey`, so a second run in the same period builds nothing. What
     * the short interval buys is that a night the process was down heals itself
     * on the next tick instead of skipping a brand's day until somebody notices.
     */
    name: "buildSettlements",
    run: buildSettlements,
    intervalMinutes: () => 60,
  },
  {
    /**
     * A NEFT that was started and never confirmed. Alerts; never acts — the
     * money may genuinely have left, and MANUAL_BANK has no recall.
     */
    name: "sweepStalePayouts",
    run: sweepStalePayouts,
    intervalMinutes: () => 30,
  },
  {
    // Money owed past the window we promised, so the first to know is not the
    // vendor waiting for it.
    name: "alertLateSettlements",
    run: alertLateSettlements,
    intervalMinutes: () => 60,
  },
  {
    /**
     * Do the books and the bank transfers agree? Read-only — a ledger row is
     * never updated and never deleted, and a sweep that could post its own
     * entries would be a second, unguarded path to the books changing.
     */
    name: "reconcileSettlementLedger",
    run: reconcileSettlementLedger,
    intervalMinutes: () => 180,
  },
  {
    /**
     * Rows still claimed by a settlement that is finished with them — the
     * `beforeRelease` throw that leaves a terminal settlement holding money
     * nobody can reach. Releasing is safe: these are the statuses that are
     * defined as releasing.
     */
    name: "sweepStrandedClaims",
    run: sweepStrandedClaims,
    intervalMinutes: () => 60,
  },
  {
    /**
     * An empty `DRAFT` left by a build that died between writing the shell and
     * claiming its rows. Its key still occupies the period, so the next build
     * skips that brand's day — for ever, silently.
     */
    name: "sweepAbandonedDrafts",
    run: sweepAbandonedDrafts,
    intervalMinutes: () => 60,
  },
  {
    /**
     * ⚠️ A debt no cycle can reach.
     *
     * A negative `netPayable` carries forward, and carrying forward releases
     * every claim it held — right while the brand still trades, because new
     * sales net it off. The day they stop, the same rows are claimed and
     * released every cycle for ever: nothing errors, nothing is logged, and the
     * money sits on our books as a receivable from somebody who is not coming
     * back.
     *
     * Daily, because the state is static — a brand in this position is in it
     * tomorrow too, and anything tighter is noise on a decision nobody makes at
     * 3am. It alerts and never acts: writing a debt off has a person's name on
     * it. See `writeOffVendorDebt`.
     */
    name: "alertVendorDebt",
    run: alertVendorDebt,
    intervalMinutes: () => 24 * 60,
  },
  {
    /**
     * ⚠️ A blanket unique index an older build of this service keeps recreating.
     *
     * `invoiceId_1` rejects the **second** transaction with no invoice yet, and
     * every voucher claim is created before its invoice exists — so while it is
     * there, roughly every second claim fails with a duplicate-key error naming
     * a field the customer never touched. Nothing else reports that as a fault:
     * to every other layer it looks like a validation error.
     *
     * Nothing in this build creates it. Commit `59fd080` declared
     * `invoiceId: { unique: true }`; `3494bb8` replaced it with a named partial.
     * It came back twice anyway, because an older build is still running against
     * the same cluster and Mongoose's `autoIndex` rebuilds it on every restart —
     * and those builds connected with no options, so `MONGO_AUTO_INDEX=false`
     * cannot reach them.
     *
     * Hourly, because boot alone leaves a shadow created after a deploy sitting
     * until the next one. And a reap means the other writer restarted inside the
     * last hour — which is the only usable lead for finding it, so each one
     * alerts rather than being quietly cleaned up.
     */
    name: "reapShadowIndexes",
    run: reapShadowIndexesJob,
    intervalMinutes: () => 60,
  },
  {
    /**
     * ⚠️ The only money deadline nothing else watches.
     *
     * `disputeRespondBy` was written by the webhook and read by nobody. A dispute
     * deadline that passes is an **automatic loss** — the bank does not ask
     * twice, Razorpay does not chase, and no error is raised, because from the
     * system's point of view nothing happened.
     *
     * Hourly, not daily: the last warning fires 24h out, and a daily sweep can
     * land that one anywhere in the final day — including after it.
     *
     * Alerts only. Filing evidence needs a person with the Razorpay dashboard,
     * and there is exactly one response per dispute.
     */
    name: "disputeDeadlines",
    run: disputeDeadlines,
    intervalMinutes: () => 60,
  },
];

const inFlight = new Set();
const timers = [];
// The interval each job was last scheduled at, so the health check can judge
// staleness on a job that has not completed a run yet.
const scheduledIntervals = new Map();

const jobsEnabled = () => process.env.ENABLE_JOBS !== "false";

const runJob = async (job) => {
  // Cheap in-process guard first — no point paying for a DB round trip to
  // discover we are already busy.
  if (inFlight.has(job.name)) {
    console.warn(`⏭️  [jobs] ${job.name} still running, skipping this tick`);
    return { skipped: JOB_SKIP_REASON.IN_FLIGHT };
  }

  const acquired = await acquireJobLock(job.name);
  if (!acquired) {
    console.log(`🔒 [jobs] ${job.name} held by another instance, skipping`);
    return { skipped: JOB_SKIP_REASON.LOCKED };
  }

  inFlight.add(job.name);
  const stopHeartbeat = startJobLockHeartbeat(job.name);
  const startedAt = Date.now();
  let result = null;
  let failure = null;

  try {
    result = await job.run();
    console.log(
      `✅ [jobs] ${job.name} finished in ${Date.now() - startedAt}ms`,
      result ?? "",
    );
  } catch (error) {
    failure = error;
    console.error(`❌ [jobs] ${job.name} failed:`, error?.message);
  } finally {
    stopHeartbeat();
    inFlight.delete(job.name);
    // Outside the try/catch above on purpose: the run's own outcome is already
    // decided, and a bookkeeping failure must not turn a success into a failure.
    // `releaseJobLock` never throws.
    await releaseJobLock(job.name, {
      success: !failure,
      durationMs: Date.now() - startedAt,
      result,
      error: failure?.message,
      intervalMinutes: scheduledIntervals.get(job.name),
    });
  }

  return failure ? { failed: true } : { result };
};

/**
 * Say out loud what the runner is and is not doing.
 *
 * Same idea as `logPaymentAccounts()`: a boot line costs nothing and turns a
 * silent misconfiguration into something someone notices in the deploy log.
 */
const logJobStatus = async () => {
  if (!jobsEnabled()) {
    console.log(
      `⏸️  [jobs] DISABLED via ENABLE_JOBS=false — no sweeps, no reconciliation, no reminders on this instance`,
    );
    return;
  }

  console.log(
    `✅ [jobs] ${registry.length} registered · lock: enabled · instance ${INSTANCE_ID}`,
  );

  // A job that has not succeeded in three of its own intervals is either broken
  // or has not been running at all, and both are worth a line at boot rather
  // than a discovery later.
  try {
    const health = await getJobHealth(
      registry.map((job) => ({
        name: job.name,
        intervalMinutes: scheduledIntervals.get(job.name),
      })),
      true,
    );
    for (const job of health.jobs) {
      if (job.status === JOB_HEALTH_STATUS.CRITICAL) {
        console.warn(
          `⚠️  [jobs] ${job.name} last succeeded ${job.minutesSinceLastSuccess}m ago (every ${job.intervalMinutes}m) — was this instance down?`,
        );
      }
      if (job.consecutiveFailures >= 3) {
        console.warn(
          `⚠️  [jobs] ${job.name} has failed ${job.consecutiveFailures} times in a row: ${job.lastError}`,
        );
      }
    }
  } catch (error) {
    console.error("[jobs] health check failed at boot:", error?.message);
  }
};

exports.startJobs = async () => {
  if (!jobsEnabled()) {
    await logJobStatus();
    return;
  }

  for (const job of registry) {
    let minutes = DEFAULT_INTERVAL_MINUTES;
    try {
      minutes = await job.intervalMinutes();
    } catch (error) {
      console.error(
        `[jobs] could not read interval for ${job.name}, using ${minutes}m:`,
        error?.message,
      );
    }
    scheduledIntervals.set(job.name, minutes);

    // Catch up on anything that lapsed while the process was down. On a
    // multi-instance deploy every instance reaches this line at once, which is
    // precisely what the lock is here for — one runs, the rest skip.
    await runJob(job);

    const timer = setInterval(() => runJob(job), minutes * MINUTE_MS);
    // Do not hold the event loop open on shutdown.
    if (typeof timer.unref === "function") timer.unref();
    timers.push(timer);

    console.log(`🕒 [jobs] ${job.name} scheduled every ${minutes}m`);
  }

  await logJobStatus();
};

exports.stopJobs = () => {
  timers.forEach(clearInterval);
  timers.length = 0;
};

// Exposed so an admin endpoint or a script can trigger a sweep on demand. Takes
// the same lock as a scheduled tick — an admin pressing the button while a tick
// is in flight would otherwise be the one case the locking does not cover.
exports.runJobNow = async (name) => {
  const job = registry.find((entry) => entry.name === name);
  if (!job) throw new Error(`Unknown job: ${name}`);
  return runJob(job);
};

/** Every registered job's name and interval, for the admin health endpoint. */
exports.getJobRegistry = () =>
  registry.map((job) => ({
    name: job.name,
    intervalMinutes: scheduledIntervals.get(job.name) || null,
  }));

/** The health of every registered job. Reads `ENABLE_JOBS` at call time. */
exports.getJobsHealth = () => getJobHealth(exports.getJobRegistry(), jobsEnabled());
