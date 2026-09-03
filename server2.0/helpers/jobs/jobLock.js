const JobLock = require("../../models/JobLock");
const { INSTANCE_ID } = require("./instanceId");
const {
  JOB_LOCK_LEASE_MINUTES,
  JOB_LOCK_HEARTBEAT_MINUTES,
  JOB_ERROR_MAX_LENGTH,
} = require("../../constants/job");

const MINUTE_MS = 60 * 1000;
const { DUPLICATE_KEY } = require("../../constants/mongo");

/**
 * Take the lock for a job, if nobody else holds it.
 *
 * ### The upsert-and-catch-11000 pattern
 *
 * ```js
 * findOneAndUpdate({ _id: name, expiresAt: { $lt: now } }, { … }, { upsert: true })
 * ```
 *
 * Three cases, and the third is the one that needs explaining:
 *
 *  - **No row yet.** The filter matches nothing, the upsert inserts one, we hold
 *    the lock.
 *  - **Row exists, lease expired.** The filter matches, the update takes it over.
 *  - **Row exists, lease live.** The filter matches nothing *and* the upsert
 *    tries to insert `_id: name`, which already exists — so Mongo raises a
 *    duplicate key error. That error **is** the "someone else has it" signal,
 *    not a failure, and is caught and reported as a clean miss.
 *
 * The whole thing is one atomic operation, so two instances booting in the same
 * millisecond cannot both win.
 *
 * @returns {Promise<boolean>} true if this process now holds the lock
 */
exports.acquireJobLock = async (name, leaseMinutes = JOB_LOCK_LEASE_MINUTES) => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + leaseMinutes * MINUTE_MS);

  try {
    await JobLock.findOneAndUpdate(
      {
        _id: name,
        // `$lte` rather than `$lt`: `releaseJobLock` sets `expiresAt` to exactly
        // now, and on a fast machine the next tick can arrive within the same
        // millisecond. `$lt` would refuse a lock nobody holds.
        $or: [{ expiresAt: null }, { expiresAt: { $lte: now } }],
      },
      {
        $set: { lockedBy: INSTANCE_ID, lockedAt: now, expiresAt },
      },
      { upsert: true, returnDocument: "after" },
    );
    return true;
  } catch (error) {
    if (error?.code === DUPLICATE_KEY) {
      // Held by a live lease. Expected on a multi-instance deploy.
      await JobLock.updateOne({ _id: name }, { $inc: { lockedOutCount: 1 } });
      return false;
    }
    // Anything else — the DB is unreachable, the write failed — is not a lock
    // decision. Refusing to run is the safe answer: running unlocked is how two
    // instances double-charge a payment API.
    console.error(`[jobs] could not acquire lock for ${name}:`, error?.message);
    return false;
  }
};

/**
 * Push this process's lease further out while the job is still working.
 *
 * Scoped to `lockedBy: INSTANCE_ID`, so a process whose lease already lapsed and
 * was taken over cannot reach in and extend someone else's lock.
 *
 * @returns {Promise<boolean>} false if the lock is no longer ours
 */
exports.renewJobLock = async (name, leaseMinutes = JOB_LOCK_LEASE_MINUTES) => {
  const expiresAt = new Date(Date.now() + leaseMinutes * MINUTE_MS);
  try {
    const result = await JobLock.updateOne(
      { _id: name, lockedBy: INSTANCE_ID },
      { $set: { expiresAt } },
    );
    return result.modifiedCount > 0 || result.matchedCount > 0;
  } catch (error) {
    console.error(`[jobs] heartbeat failed for ${name}:`, error?.message);
    return false;
  }
};

/**
 * Start a heartbeat that keeps the lease alive for the duration of a run.
 *
 * Without it the lease would have to be long enough for the slowest imaginable
 * run, which in turn is how long a *crashed* instance blocks that job. The
 * heartbeat lets the lease stay short while a genuinely slow job keeps its lock.
 *
 * @returns {Function} call to stop the heartbeat
 */
exports.startJobLockHeartbeat = (name, leaseMinutes = JOB_LOCK_LEASE_MINUTES) => {
  const timer = setInterval(
    () => {
      exports.renewJobLock(name, leaseMinutes).then((held) => {
        if (!held) {
          // We lost the lease — the run took longer than the heartbeat could
          // cover, or the row was cleared. Worth saying out loud: another
          // instance may now be running the same job alongside this one.
          console.warn(
            `⚠️  [jobs] ${name} lost its lock while running — another instance may have taken over`,
          );
        }
      });
    },
    JOB_LOCK_HEARTBEAT_MINUTES * MINUTE_MS,
  );
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
};

/**
 * Hand the lock back and record how the run went.
 *
 * `expiresAt` is set to *now* rather than cleared, so the next scheduled tick —
 * on any instance — can take it immediately instead of waiting out a lease.
 *
 * Never throws. A job that succeeded must not be reported as failed because the
 * bookkeeping write did not land; the run already happened.
 */
exports.releaseJobLock = async (
  name,
  { success, durationMs, result, error, intervalMinutes } = {},
) => {
  const now = new Date();

  const update = {
    $set: {
      lastRunAt: now,
      lastDurationMs: durationMs ?? null,
      ...(intervalMinutes ? { intervalMinutes } : {}),
    },
  };

  if (success) {
    update.$set.lastSuccessfulRunAt = now;
    update.$set.lastResult = result ?? null;
    update.$set.lastError = null;
    update.$set.consecutiveFailures = 0;
  } else {
    update.$set.lastFailedAt = now;
    update.$set.lastError = String(error || "Unknown error").slice(
      0,
      JOB_ERROR_MAX_LENGTH,
    );
    update.$inc = { consecutiveFailures: 1 };
  }

  try {
    /**
     * Two writes, because the two halves have opposite ownership rules.
     *
     * **The health fields land either way.** Losing a lease mid-run is exactly
     * when the outcome is most worth knowing, so this is not scoped.
     */
    await JobLock.updateOne({ _id: name }, update, { upsert: true });

    /**
     * ⚠️ **The lease is only released if it is still ours.**
     *
     * This used to clear `lockedBy` and `expiresAt` in the same unscoped write,
     * which is a correctness bug rather than a tidiness one: a slow instance
     * whose lease lapsed, and whose job another instance has since picked up,
     * would finish and wipe the *live* lease out from under it. A third
     * instance then acquires freely and the same money job runs twice at once —
     * the precise thing the lock exists to prevent, caused by the lock's own
     * release path.
     *
     * If we no longer hold it, this matches nothing and does nothing, which is
     * the correct outcome: the lease belongs to whoever holds it now, and it
     * will expire on its own schedule.
     */
    await JobLock.updateOne(
      { _id: name, lockedBy: INSTANCE_ID },
      {
        $set: {
          lockedBy: null,
          // In the past, not null: `acquireJobLock` treats both as available,
          // and a timestamp leaves a readable trace of when the run ended.
          expiresAt: now,
        },
      },
    );
  } catch (writeError) {
    console.error(
      `[jobs] could not record the outcome of ${name}:`,
      writeError?.message,
    );
  }
};
