const {
  expireSubscriptions,
  sendExpiryReminders,
} = require("../services/subscribeds");
const { expireVouchers } = require("../services/vouchers");
const {
  releaseStalePromoReservations,
} = require("../helpers/promoCodes");
const { getSubscriptionConfig } = require("../helpers/settings");

/**
 * Minimal background job runner.
 *
 * Deliberately dependency-free (`setInterval`, no cron library): the only thing
 * needed here is "run this every N minutes, and once on boot", and adding a
 * scheduling dependency for that is not worth it.
 *
 * Each job is wrapped so that:
 *  - a throw is logged and swallowed — one bad run must not kill the interval,
 *  - runs cannot overlap — a slow sweep will not be re-entered while in flight.
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
];

const inFlight = new Set();
const timers = [];

const runJob = async (job) => {
  if (inFlight.has(job.name)) {
    console.warn(`⏭️  [jobs] ${job.name} still running, skipping this tick`);
    return;
  }
  inFlight.add(job.name);
  const startedAt = Date.now();
  try {
    const result = await job.run();
    console.log(
      `✅ [jobs] ${job.name} finished in ${Date.now() - startedAt}ms`,
      result ?? "",
    );
  } catch (error) {
    console.error(`❌ [jobs] ${job.name} failed:`, error?.message);
  } finally {
    inFlight.delete(job.name);
  }
};

exports.startJobs = async () => {
  if (process.env.ENABLE_JOBS === "false") {
    console.log("⏸️  [jobs] disabled via ENABLE_JOBS=false");
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

    // Catch up on anything that lapsed while the process was down.
    await runJob(job);

    const timer = setInterval(() => runJob(job), minutes * MINUTE_MS);
    // Do not hold the event loop open on shutdown.
    if (typeof timer.unref === "function") timer.unref();
    timers.push(timer);

    console.log(`🕒 [jobs] ${job.name} scheduled every ${minutes}m`);
  }
};

exports.stopJobs = () => {
  timers.forEach(clearInterval);
  timers.length = 0;
};

// Exposed so an admin endpoint or a script can trigger a sweep on demand.
exports.runJobNow = async (name) => {
  const job = registry.find((entry) => entry.name === name);
  if (!job) throw new Error(`Unknown job: ${name}`);
  return runJob(job);
};
