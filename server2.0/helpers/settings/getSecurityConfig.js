const { getSetting } = require("./getSetting");
const { OTP_DEFAULTS } = require("../../constants/otp");

/**
 * Settings that are not one audience's — they apply to whoever is logging in.
 *
 * Same shape as `getCustomerConfig`: the stored document wins, and the constants
 * are the last-resort fallback. That matters more than it looks, because a
 * `Setting` document created before this block existed has nothing under
 * `security` at all — a Mongoose default applies on **write**, not on read — and
 * without the fallback `sendOtp` would get `undefined` for both numbers.
 *
 * ⚠️ `??`, never `||`. `resendCooldownSeconds: 0` is a legitimate value meaning
 * "no cooldown", and `||` would quietly turn that into 60 — an admin who
 * deliberately turned the wait off would keep seeing it, with the settings screen
 * insisting it was zero.
 */
exports.getSecurityConfig = async () => {
  const setting = await getSetting();
  const otp = setting?.security?.otp || {};

  return {
    otp: {
      resendCooldownSeconds:
        otp.resendCooldownSeconds ?? OTP_DEFAULTS.resendCooldownSeconds,
      maxPerHour: otp.maxPerHour ?? OTP_DEFAULTS.maxPerHour,
    },
  };
};
