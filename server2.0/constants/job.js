/**
 * Background job coordination and health.
 *
 * The job runner is the safety net under the whole money flow — reconciling
 * payments, resuming interrupted settlements, releasing stale holds. A safety
 * net only works while it is actually running, and the two ways it quietly
 * stops working are:
 *
 *  1. **More than one instance.** `jobs/index.js` is an in-process
 *     `setInterval`, so two dynos means every job runs twice, racing each other
 *     and double-hitting the Razorpay API.
 *  2. **Nothing running at all.** `ENABLE_JOBS=false` left set, or a process
 *     down for hours. Nothing errors — the sweeps simply stop, and it surfaces
 *     later as money stuck somewhere.
 *
 * `JobLock` addresses both: it is the cross-process twin of the runner's own
 * `inFlight` set, and the same document carries the last-run history that makes
 * a silent stoppage visible.
 */

/**
 * How long a lock is held before another instance may take it.
 *
 * A lease rather than a permanent flag: a process that is killed mid-run cannot
 * release its lock, and without an expiry that job would never run again on any
 * instance. The lease is renewed by a heartbeat while the job is actually
 * working, so a genuinely slow job keeps its lock and only a *dead* one loses
 * it.
 */
const JOB_LOCK_LEASE_MINUTES = 15;

/**
 * How often a running job pushes its lease out.
 *
 * A third of the lease, so two consecutive heartbeats can be missed — a GC
 * pause, a slow write — before another instance is entitled to take over.
 */
const JOB_LOCK_HEARTBEAT_MINUTES = JOB_LOCK_LEASE_MINUTES / 3;

/**
 * When a job's last success is old enough to be a problem.
 *
 * Measured in multiples of that job's own interval, so a 15-minute sweep and a
 * 3-hour reminder are judged on the same scale. Two missed runs is worth a
 * flag on the health page; three is worth waking someone.
 */
const JOB_HEALTH_THRESHOLDS = Object.freeze({
  WARN_INTERVAL_MULTIPLE: 2,
  CRITICAL_INTERVAL_MULTIPLE: 3,
});

const JOB_HEALTH_STATUS = Object.freeze({
  OK: "OK",
  // Ran, but not recently enough.
  STALE: "STALE",
  // Long enough that something is wrong, not just slow.
  CRITICAL: "CRITICAL",
  // Registered but has never completed a run — normal for the first minutes
  // after a deploy, not normal an hour later.
  NEVER_RUN: "NEVER_RUN",
  // `ENABLE_JOBS=false` on this instance. Not a failure, but it must not be
  // reported as healthy either.
  DISABLED: "DISABLED",
});

/**
 * Why a tick did not run.
 *
 * Distinguished because they mean opposite things operationally: `LOCKED` is the
 * lock doing its job on a multi-instance deploy and is expected, while
 * `IN_FLIGHT` means this same process is still busy with the previous tick.
 */
const JOB_SKIP_REASON = Object.freeze({
  IN_FLIGHT: "IN_FLIGHT",
  LOCKED: "LOCKED",
  DISABLED: "DISABLED",
});

/** Truncation limit for a stored error message — enough to identify it. */
const JOB_ERROR_MAX_LENGTH = 500;

module.exports = {
  JOB_LOCK_LEASE_MINUTES,
  JOB_LOCK_HEARTBEAT_MINUTES,
  JOB_HEALTH_THRESHOLDS,
  JOB_HEALTH_STATUS,
  JOB_SKIP_REASON,
  JOB_ERROR_MAX_LENGTH,
};
