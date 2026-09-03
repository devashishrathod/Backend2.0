const DeviceToken = require("../../models/DeviceToken");
const { sendPush } = require("./fcmClient");

// A token that keeps failing without the provider explicitly rejecting it stops
// being worth trying.
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Push a notification to every active device of the given users.
 *
 * Sits between the notification layer and the provider so nothing above it deals
 * with tokens: callers name *users*, this finds their devices. Entirely
 * role-agnostic — vendors, customers, sub-vendors and any future role are the
 * same thing here.
 *
 * Keeps the token table honest as a side effect:
 *  - tokens the provider says are gone (app uninstalled, token rotated) are
 *    deactivated, so a dead device is not retried forever
 *  - repeated soft failures are counted, and a token that crosses the threshold
 *    is deactivated too
 *  - a successful send clears the counter and stamps `lastPushAt`
 *
 * **Never throws.** Push is best-effort; the in-app row is the record.
 *
 * @param {Array} userIds
 * @param {object} message { title, body, data, imageUrl }
 */
exports.dispatchPush = async (userIds = [], message = {}) => {
  try {
    const ids = [...new Set(userIds.filter(Boolean).map(String))];
    if (!ids.length) return { sent: 0, failed: 0, devices: 0 };

    const devices = await DeviceToken.find({
      userId: { $in: ids },
      isActive: true,
    })
      .select("_id token userId")
      .lean();

    if (!devices.length) {
      return { sent: 0, failed: 0, devices: 0, reason: "no active devices" };
    }

    const result = await sendPush(
      devices.map((d) => d.token),
      message,
    );

    if (result.skipped) {
      return { ...result, devices: devices.length };
    }

    const byToken = new Map(devices.map((d) => [d.token, d]));
    const now = new Date();

    // Provider said these are gone — retire them.
    if (result.deadTokens.length) {
      await DeviceToken.updateMany(
        { token: { $in: result.deadTokens } },
        {
          $set: {
            isActive: false,
            deactivatedAt: now,
            deactivatedReason: "Rejected by the push provider as unregistered",
          },
        },
      );
    }

    const succeeded = result.results.filter((r) => r.sent).map((r) => r.token);
    if (succeeded.length) {
      await DeviceToken.updateMany(
        { token: { $in: succeeded } },
        { $set: { lastPushAt: now, failureCount: 0 } },
      );
    }

    // Soft failures: count them, and retire anything that has failed too often.
    const softFailed = result.results
      .filter((r) => !r.sent && !r.isDead)
      .map((r) => r.token);
    if (softFailed.length) {
      await DeviceToken.updateMany(
        { token: { $in: softFailed } },
        { $inc: { failureCount: 1 } },
      );
      await DeviceToken.updateMany(
        {
          token: { $in: softFailed },
          failureCount: { $gte: MAX_CONSECUTIVE_FAILURES },
        },
        {
          $set: {
            isActive: false,
            deactivatedAt: now,
            deactivatedReason: `Deactivated after ${MAX_CONSECUTIVE_FAILURES} consecutive delivery failures`,
          },
        },
      );
    }

    return {
      sent: result.sent,
      failed: result.failed,
      devices: devices.length,
      users: ids.length,
      deactivated: result.deadTokens.length,
      // Distinct users actually reached, which is more meaningful than a device
      // count when someone has three devices.
      usersReached: new Set(
        succeeded.map((t) => String(byToken.get(t)?.userId)),
      ).size,
    };
  } catch (error) {
    console.error("[dispatchPush] failed:", error?.message);
    return { sent: 0, failed: 0, devices: 0, error: error?.message };
  }
};
