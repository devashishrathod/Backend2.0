/**
 * What the mobile app is allowed to know before anybody signs in.
 *
 * ### Why this block exists at all
 *
 * `Setting` held every knob the platform has — commission rates, reserve
 * percentages, settlement timing, gateway-fee bearer — behind `isAdmin`. So the
 * app had no way to read even the harmless half: no minimum version, no support
 * number, no feature flags. Force-update was impossible without hardcoding a
 * number into a build that then could not be changed, which is the one thing a
 * force-update exists to avoid.
 *
 * ### ⚠️ Everything here is public, and that is the point
 *
 * These defaults define a **whitelist**. `getAppConfig` builds its response from
 * this shape and nothing else — never from `Setting` minus a few keys. The
 * difference matters the day somebody adds `commissionPercent` to a settings
 * block: with a whitelist it stays invisible until named, with a delete-list it
 * is public the moment it is written.
 *
 * The same reasoning as `/brands/customer/get/:brandId` being its own endpoint
 * rather than a filtered `/brands/get`.
 */

/** Semver-ish `major.minor.patch`. Compared numerically, never as strings. */
const APP_VERSION_DEFAULTS = Object.freeze({
  android: "1.0.0",
  ios: "1.0.0",
});

const APP_CONFIG_DEFAULTS = Object.freeze({
  /**
   * Below this, the app must update before it can be used.
   *
   * ⚠️ Kept separate from `latestVersion` deliberately. Telling somebody a newer
   * build exists is a nudge; refusing to let them past the splash screen is a
   * different decision, and collapsing the two means every release locks out
   * every user who has not updated yet.
   */
  minVersion: APP_VERSION_DEFAULTS,
  latestVersion: APP_VERSION_DEFAULTS,

  /**
   * The override for "update now, not later".
   *
   * `false` by default because the honest default is not to lock anyone out.
   * With `minVersion` doing the real work, this is the switch for the case where
   * a shipped build is actively broken and the version numbers have not caught
   * up yet.
   */
  forceUpdate: false,

  updateMessage:
    "A newer version of Trydood is available. Please update to continue.",

  storeUrl: Object.freeze({ android: "", ios: "" }),

  /**
   * Where a stuck customer goes.
   *
   * ⚠️ This is the field that makes the whole endpoint worth having on day one:
   * every refusal in the refund flow ends with "write to support", and until now
   * the app had to hardcode the address that sentence points at.
   */
  support: Object.freeze({ email: "", phone: "", whatsapp: "" }),

  /**
   * Switches the app reads to decide whether a screen exists at all.
   *
   * ⚠️ These describe the **app's** surface, not the server's enforcement. A
   * `false` here hides a button; it does not close an endpoint. The endpoint
   * that must refuse still refuses on its own — `create-order` already returns a
   * hard `422` when promo codes are off, and it would keep doing so if this flag
   * said otherwise.
   */
  features: Object.freeze({
    promoCodes: true,
    refunds: true,
    voucherClaims: true,
    search: true,
  }),
});

module.exports = { APP_CONFIG_DEFAULTS, APP_VERSION_DEFAULTS };
