const { getSetting } = require("./getSetting");
const { getCustomerConfig } = require("./getCustomerConfig");
const { APP_CONFIG_DEFAULTS } = require("../../constants/app");

/**
 * The public app config — **a whitelist, assembled field by field**.
 *
 * ⚠️ This is the only settings reader whose output reaches an unauthenticated
 * caller, so it is written the opposite way round from the others: nothing is
 * spread, nothing is deleted. Every key below was named on purpose.
 *
 * `Setting` also holds `commissionPercent`, the reserve rates, settlement timing
 * and the gateway-fee bearer. A `...setting.customer` anywhere in this file
 * would publish the platform's economics, and it would not look wrong on the
 * line that did it — it would look like every other config helper in this
 * folder. That is exactly why this one does not resemble them.
 */

/**
 * `"1.12.3"` → `[1, 12, 3]`, padded, non-numeric parts dropped to `0`.
 *
 * ⚠️ String comparison is the trap here: `"1.10.0" < "1.9.0"` is **true** as
 * text, so a lexical check tells a user on the newer build to update. Comparing
 * numerically per segment is the only version of this that is right.
 */
const parseVersion = (value) =>
  String(value || "")
    .split(".")
    .slice(0, 3)
    .map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    })
    .concat([0, 0, 0])
    .slice(0, 3);

/** `-1` if a < b, `0` if equal, `1` if a > b. */
const compareVersions = (a, b) => {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
};

/**
 * @param {object} [query]
 * @param {"android"|"ios"} [query.platform] which minimum applies
 * @param {string} [query.version] the build asking — enables `updateRequired`
 */
exports.getAppConfig = async (query = {}) => {
  const setting = await getSetting();
  const app = setting?.app || {};
  const customer = await getCustomerConfig();

  const minVersion = {
    android: app.minVersion?.android || APP_CONFIG_DEFAULTS.minVersion.android,
    ios: app.minVersion?.ios || APP_CONFIG_DEFAULTS.minVersion.ios,
  };
  const latestVersion = {
    android:
      app.latestVersion?.android || APP_CONFIG_DEFAULTS.latestVersion.android,
    ios: app.latestVersion?.ios || APP_CONFIG_DEFAULTS.latestVersion.ios,
  };

  const platform = query.platform === "ios" ? "ios" : "android";
  const version = query.version;

  /**
   * The comparison is done **here**, not in the app.
   *
   * Two apps implementing "is my version below the minimum" is two chances to
   * get the `"1.10.0" vs "1.9.0"` case wrong, in builds that cannot then be
   * corrected without the very update they failed to demand.
   *
   * `null` when the caller did not say which version it is — an honest "not
   * asked" rather than a `false` the client might trust.
   */
  const updateRequired = version
    ? compareVersions(version, minVersion[platform]) < 0 ||
      Boolean(app.forceUpdate ?? APP_CONFIG_DEFAULTS.forceUpdate)
    : null;

  const updateAvailable = version
    ? compareVersions(version, latestVersion[platform]) < 0
    : null;

  return {
    app: {
      minVersion,
      latestVersion,
      forceUpdate: app.forceUpdate ?? APP_CONFIG_DEFAULTS.forceUpdate,
      updateMessage: app.updateMessage || APP_CONFIG_DEFAULTS.updateMessage,
      storeUrl: {
        android: app.storeUrl?.android || APP_CONFIG_DEFAULTS.storeUrl.android,
        ios: app.storeUrl?.ios || APP_CONFIG_DEFAULTS.storeUrl.ios,
      },
      // Echoed back so a client can see which minimum it was judged against.
      platform,
      updateRequired,
      updateAvailable,
    },

    support: {
      email: app.support?.email || APP_CONFIG_DEFAULTS.support.email,
      phone: app.support?.phone || APP_CONFIG_DEFAULTS.support.phone,
      whatsapp: app.support?.whatsapp || APP_CONFIG_DEFAULTS.support.whatsapp,
    },

    /**
     * ⚠️ These hide **screens**, they do not close endpoints.
     *
     * `create-order` still returns a hard `422` when promo codes are off,
     * whatever this says. Treating a flag here as the enforcement is how a
     * feature ends up "disabled" in the UI and wide open on the API.
     */
    features: {
      promoCodes:
        app.features?.promoCodes ?? APP_CONFIG_DEFAULTS.features.promoCodes,
      refunds: app.features?.refunds ?? APP_CONFIG_DEFAULTS.features.refunds,
      voucherClaims:
        app.features?.voucherClaims ??
        APP_CONFIG_DEFAULTS.features.voucherClaims,
      search: app.features?.search ?? APP_CONFIG_DEFAULTS.features.search,
    },

    /**
     * The handful of customer-facing numbers the app renders before anyone signs
     * in — the bill screen shows the convenience fee slab, and the refund screen
     * shows the window.
     *
     * ⚠️ Named one at a time out of `getCustomerConfig`, never spread. That
     * object also carries commission, reserve rates, settlement delay and
     * chargeback config, and this endpoint is public.
     */
    pricing: {
      currency: "INR",
      currencySymbol: "₹",
      convenienceFee: {
        isEnabled: customer.convenienceFee.isEnabled,
        slabSize: customer.convenienceFee.slabSize,
        feePerSlab: customer.convenienceFee.feePerSlab,
        maxFee: customer.convenienceFee.maxFee,
      },
    },

    refund: {
      // "You can ask for a refund within 24 hours" — the app states this before
      // the customer has bought anything, so it cannot come from a claim.
      windowHours: customer.refund.windowHours,
      allowPartial: customer.refund.allowPartial,
    },
  };
};

exports.compareVersions = compareVersions;
