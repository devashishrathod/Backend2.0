const DeviceToken = require("../../models/DeviceToken");
const { throwError } = require("../../utils");

/**
 * Register (or refresh) the calling user's push device.
 *
 * Called on login and whenever the client's provider token rotates — which FCM
 * does on its own — so this has to be safe to call repeatedly. It is an upsert on
 * the token, never an insert.
 *
 * Two things it deliberately handles, because both are real and both leak
 * notifications to the wrong person if they are not:
 *
 *  1. **The token already exists under another user.** A provider token
 *     identifies an app install, and an install changes hands: a shared phone, a
 *     logout and login as someone else. The row is *reassigned* to the caller
 *     rather than duplicated, so the previous owner stops receiving pushes on a
 *     device that is no longer theirs.
 *
 *  2. **The same install came back with a new token.** Matched on `deviceId` and
 *     the stale row is retired, so a reinstall does not leave a dead token behind
 *     that fails on every send until the failure counter retires it.
 *
 * Role-agnostic: a vendor, a customer, a sub-vendor and any role added later all
 * take this same path.
 */
exports.registerDeviceToken = async (actor, payload = {}) => {
  const { token, platform, deviceId, deviceName, appVersion } = payload;

  if (!actor?.userId || !actor?.role) {
    throwError(401, "Authentication is required to register a device.");
  }

  const now = new Date();

  // A reinstall or app upgrade on a known device: retire whatever token that
  // device was using before, unless it is the very token being registered.
  if (deviceId) {
    await DeviceToken.updateMany(
      {
        userId: actor.userId,
        deviceId,
        token: { $ne: token },
        isActive: true,
      },
      {
        $set: {
          isActive: false,
          deactivatedAt: now,
          deactivatedReason: "Replaced by a newer token from the same device",
        },
      },
    );
  }

  // Upsert on the token: reassigns an install that changed hands, reactivates
  // one that had been retired, and refreshes the denormalised role.
  const device = await DeviceToken.findOneAndUpdate(
    { token },
    {
      $set: {
        userId: actor.userId,
        role: actor.role,
        platform,
        ...(deviceId ? { deviceId } : {}),
        ...(deviceName ? { deviceName } : {}),
        ...(appVersion ? { appVersion } : {}),
        isActive: true,
        lastSeenAt: now,
        // A previously-dead token that the client sends again deserves a clean
        // slate; the reason it failed before may well be gone.
        failureCount: 0,
      },
      $unset: { deactivatedAt: "", deactivatedReason: "" },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
    .select("-__v")
    .lean();

  const activeDevices = await DeviceToken.countDocuments({
    userId: actor.userId,
    isActive: true,
  });

  return { device, activeDevices };
};
