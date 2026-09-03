const DeviceToken = require("../../models/DeviceToken");
const { throwError } = require("../../utils");

/**
 * Retire push devices for the calling user — what logout calls.
 *
 * Pass `token` to retire one device, or `allDevices: true` for every device of
 * this user ("log out everywhere"). Rows are deactivated, not deleted, so past
 * delivery stays explicable.
 *
 * The filter always carries `userId`, so one user cannot silence another's device
 * by sending its token. An unknown or already-retired token is **not** an error:
 * logout must not fail because the client is retrying, or because the provider
 * already invalidated the token from the other side.
 */
exports.unregisterDeviceToken = async (actor, payload = {}) => {
  const { token, allDevices } = payload;

  if (!actor?.userId) {
    throwError(401, "Authentication is required to unregister a device.");
  }
  if (!token && !allDevices) {
    throwError(422, "Provide a token, or set allDevices to true.");
  }

  const filter = {
    userId: actor.userId,
    isActive: true,
    ...(allDevices ? {} : { token }),
  };

  const result = await DeviceToken.updateMany(filter, {
    $set: {
      isActive: false,
      deactivatedAt: new Date(),
      deactivatedReason: allDevices
        ? "Signed out of all devices"
        : "Signed out on this device",
    },
  });

  const activeDevices = await DeviceToken.countDocuments({
    userId: actor.userId,
    isActive: true,
  });

  return { deactivated: result.modifiedCount || 0, activeDevices };
};
