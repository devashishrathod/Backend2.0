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
