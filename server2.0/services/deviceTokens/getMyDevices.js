const DeviceToken = require("../../models/DeviceToken");
const { throwError } = require("../../utils");

/**
 * The calling user's registered devices — what a "where you're signed in" screen
 * renders, and the first thing to check when someone says push is not arriving.
 *
 * The provider token is **never returned**. It is a bearer credential: anyone
 * holding it can push to that device, so it stays server-side. A masked tail is
 * returned instead, which is enough to match a row against what the client has.
 */
exports.getMyDevices = async (actor, query = {}) => {
  if (!actor?.userId) {
    throwError(401, "Authentication is required.");
  }

  const includeInactive = query.includeInactive === true || query.includeInactive === "true";

  const devices = await DeviceToken.find({
    userId: actor.userId,
    ...(includeInactive ? {} : { isActive: true }),
  })
    .select(
      "token platform deviceId deviceName appVersion isActive deactivatedAt deactivatedReason lastSeenAt lastPushAt failureCount createdAt",
    )
    .sort({ isActive: -1, lastSeenAt: -1 })
    .lean();

  return {
    devices: devices.map(({ token, ...device }) => ({
      ...device,
      // Enough to identify the row, not enough to send with.
      tokenTail: token ? `…${String(token).slice(-8)}` : null,
    })),
    activeDevices: devices.filter((d) => d.isActive).length,
    total: devices.length,
  };
};
