const mongoose = require("mongoose");
const { userField } = require("./validObjectId");
const { ROLES } = require("../constants");
const { DEVICE_PLATFORMS } = require("../constants/notification");

/**
 * One push destination — a single app install on a single device.
 *
 * Role-agnostic by design: a vendor, a customer, a sub-vendor and any role added
 * later all register here the same way, so push targeting never needs to know
 * what kind of user it is addressing.
 *
 * `token` is unique rather than `(userId, token)`: a provider token identifies a
 * device install, and that install can change hands — a shared phone, a reinstall,
 * a logout-and-login as someone else. Registering an existing token therefore
 * **reassigns** it instead of creating a duplicate, otherwise the previous owner
 * would keep receiving the new owner's notifications.
 *
 * `role` is denormalised from the user so role-targeted sends do not need a join
 * on every dispatch; it is refreshed on each register.
 */
const deviceTokenSchema = new mongoose.Schema(
  {
    userId: { ...userField, required: true, index: true },
    role: {
      type: String,
      enum: Object.values(ROLES),
      required: true,
      index: true,
    },
    token: { type: String, required: true, unique: true, trim: true },
    platform: {
      type: String,
      enum: Object.values(DEVICE_PLATFORMS),
      required: true,
    },
    // Stable per install where the client can supply one. Lets a reinstall
    // replace its old token instead of leaving a dead row behind.
    deviceId: { type: String, trim: true },
    deviceName: { type: String, trim: true },
    appVersion: { type: String, trim: true },

    // Flipped false when the provider reports the token is gone, or on logout.
    // Rows are kept rather than deleted so delivery history stays explicable.
    isActive: { type: Boolean, default: true },
    deactivatedAt: { type: Date },
    deactivatedReason: { type: String, trim: true },

    lastSeenAt: { type: Date, default: Date.now },
    lastPushAt: { type: Date },
    // Consecutive send failures. A token failing repeatedly without the provider
    // explicitly rejecting it still stops being worth trying.
    failureCount: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);

// The dispatch query: active tokens for a set of users.
deviceTokenSchema.index({ userId: 1, isActive: 1 });
// Role-targeted sends.
deviceTokenSchema.index({ role: 1, isActive: 1 });
// Lets a reinstall find and replace its previous token.
deviceTokenSchema.index({ userId: 1, deviceId: 1 });

module.exports = mongoose.model("DeviceToken", deviceTokenSchema);
