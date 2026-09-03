const mongoose = require("mongoose");

/**
 * One row per background job: who is running it right now, and how it went last time.
 *
 * Two jobs in one document on purpose. The lock and the health history are read
 * and written by the same code path at the same moments, and keeping them
 * together means a job's whole story is one `findOne` — which is what the admin
 * health endpoint wants.
 *
 * `_id` is the job name. There is exactly one row per registered job, so the
 * collection is bounded by the registry and never grows.
 *
 * ### Why there is no TTL index
 *
 * The obvious design puts a TTL on `expiresAt` so a stale lock disappears on its
 * own. That would also **delete the health history** — `lastSuccessfulRunAt` is
 * the one field that makes a silently stopped job visible, and losing it every
 * time a lease lapsed would defeat the purpose.
 *
 * A lapsed lease needs no deletion anyway: acquisition matches on
 * `expiresAt: { $lt: now }`, so an expired lock is already available. The expiry
 * is a comparison, not a lifecycle.
 */
const jobLockSchema = new mongoose.Schema(
  {
    // The job name from the runner's registry.
    _id: { type: String, required: true },

    // ---------- the lock ----------
    /**
     * Which process holds it — `hostname:pid:boot-token`.
     *
     * The boot token matters: two processes on the same host can be handed the
     * same pid after a restart, and without it a dead instance's lock could be
     * renewed by its replacement.
     */
    lockedBy: { type: String, default: null },
    lockedAt: { type: Date, default: null },
    /**
     * When another instance becomes entitled to take over.
     *
     * Pushed forward by a heartbeat while the job is genuinely working, so a
     * slow job keeps its lock and only a dead one loses it. Set to the past on
     * release, which frees it immediately rather than after a lease.
     */
    expiresAt: { type: Date, default: null },

    // ---------- health ----------
    // Every attempt, successful or not.
    lastRunAt: { type: Date, default: null },
    // Only the ones that finished cleanly. This is the field the health check
    // reads — a job failing every tick is not a job that is running.
    lastSuccessfulRunAt: { type: Date, default: null },
    lastFailedAt: { type: Date, default: null },
    lastDurationMs: { type: Number, default: null },
    lastError: { type: String, default: null },
    /**
     * What the last successful run returned, as-is.
     *
     * Every job returns a small counts object (`{ released: 3 }`). Stored so the
     * health page can show whether a sweep is finding anything, not just that it
     * ran — a reconciler that has returned zero for a week is either healthy or
     * broken, and the count is what tells them apart.
     */
    lastResult: { type: mongoose.Schema.Types.Mixed, default: null },
    // Reset to 0 on success. A rising number is a job that is running but not
    // working, which no last-run timestamp alone would reveal.
    consecutiveFailures: { type: Number, default: 0 },
    // The interval in force at the last run, recorded so the health check can
    // judge staleness without re-reading admin settings.
    intervalMinutes: { type: Number, default: null },
    // Ticks skipped because another instance held the lock. Expected to be
    // non-zero on a multi-instance deploy and zero on a single one — a useful
    // confirmation that the lock is doing something.
    lockedOutCount: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false, _id: false },
);

module.exports = mongoose.model("JobLock", jobLockSchema);
