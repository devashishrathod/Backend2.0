const {
  reapShadowIndexes,
} = require("../../helpers/transactions/reapShadowIndexes");
const {
  sendQuietly,
  notifyAdminShadowIndexReaped,
} = require("../../helpers/notifications");

/**
 * Remove any blanket unique index that a partial one has already replaced.
 *
 * ### ⚠️ Why this is a job and not only a boot check
 *
 * `invoiceId_1` — a blanket unique that rejects the second transaction with no
 * invoice yet — came back on the cluster twice after being dropped. Nothing in
 * this build creates it: commit `59fd080` declared
 * `invoiceId: { type: String, unique: true }`, and `3494bb8` replaced it with
 * the named partial index the schema still carries.
 *
 * So an **older build of this same service** is still running against the same
 * database, and Mongoose's `autoIndex` rebuilds that path on every one of *its*
 * restarts. `MONGO_AUTO_INDEX=false` cannot stop it either — those builds
 * connected with no options at all, long before that switch existed.
 *
 * A boot-time check alone leaves the obvious hole: a shadow created an hour
 * after our deploy sits there until the next one, and while it sits, every
 * second voucher claim fails with a duplicate-key error naming a field the
 * customer never touched. Hourly bounds that window to an hour.
 *
 * ### It is also the detector
 *
 * A reap means the other writer restarted **inside the last hour**. That
 * timestamp is the one usable lead for finding it — `$currentOp`, which would
 * name it outright, is not permitted on Atlas shared tiers. So every reap alerts
 * an admin rather than being quietly cleaned up, and the alert is deliberately
 * not deduped by day: each one is a separate restart, and the count is evidence.
 *
 * ⚠️ None of this makes the writer go away. That is
 * `scripts/findIndexWriters.js` and, in the end, narrowing Atlas Network Access
 * so it cannot reach the cluster at all.
 */
exports.reapShadowIndexesJob = async () => {
  const result = await reapShadowIndexes();

  if (result.reaped.length || result.blocked.length) {
    await sendQuietly(
      () =>
        notifyAdminShadowIndexReaped({
          reaped: result.reaped,
          blocked: result.blocked,
        }),
      "admin shadow index reaped",
    );
  }

  return {
    guarded: result.guarded,
    reaped: result.reaped.length,
    blocked: result.blocked.length,
  };
};
