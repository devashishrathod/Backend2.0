const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const { notify } = require("./notify");
const { resolveBrandIdentity } = require("../brands/resolveBrandIdentity");
const {
  PANEL_PATHS,
  vendorUrl,
  deepLink,
  whatsappUrlParam,
} = require("./panelLinks");

/**
 * The notices behind `PUT /brands/admin/:brandId/status`.
 *
 * Called after the toggle commits, never inside it — `notify` never throws, and
 * a failed email must not roll back a moderation decision an admin already made.
 *
 * The internal `reason` is deliberately kept out of the vendor-facing body and
 * parked in `meta`. Admin notes are written for admins ("suspected fake GST,
 * flagged by ops"), and reading one back to the vendor verbatim is not something
 * this path should decide to do.
 *
 * That is the opposite of a verification **rejection** reason, which is written
 * for the vendor and is sent to them — see `brandVerificationNotices.js`. The two
 * fields look alike and mean different things.
 *
 * ---
 *
 * ### WhatsApp template variables
 *
 * | Env var (`WHATSAPP_TEMPLATE_…`) | Vars | Order |
 * |---|---|---|
 * | `BRAND_DEACTIVATED` | 2 | name, brand |
 * | `BRAND_ACTIVATED` | 2 | name, brand |
 * | `BRAND_HIDDEN_FROM_CUSTOMERS` | 2 | name, brand |
 * | `BRAND_VISIBLE_TO_CUSTOMERS` | 2 | name, brand |
 *
 * No reason variable, for the paragraph above.
 */

const brandLines = (identity, extra = []) =>
  [
    ["Brand", identity.brandName || identity.uniqueId || "-"],
    ["Merchant ID", identity.merchantId || "-"],
    ...extra,
  ].filter(Boolean);

const brandMeta = (brand, identity, extra = {}) => ({
  brandName: identity.brandName || brand.brandName,
  brandUniqueId: brand.uniqueId,
  merchantId: brand.merchantId,
  ...extra,
});

/**
 * The vendor lost access. Their brand and vouchers may well still be live for
 * customers — that is a separate switch — so the copy is careful to say what
 * changed and what did not.
 */
exports.notifyBrandDeactivated = async ({
  brand,
  reason,
  hiddenFromCustomers,
  awaitDelivery = false,
}) => {
  const identity = await resolveBrandIdentity(brand);

  return notify({
    brandId: brand._id,
    type: NOTIFICATION_TYPES.BRAND_DEACTIVATED,
    severity: NOTIFICATION_SEVERITY.CRITICAL,
    title: "Your account has been deactivated",
    body: hiddenFromCustomers
      ? `Hi ${identity.name}, your Trydood account has been deactivated by the Trydood team, and ${identity.brandName} has been removed from the customer app. You cannot sign in until it is restored. Nothing has been deleted. Please contact support if you believe this is a mistake.`
      : `Hi ${identity.name}, your Trydood account has been deactivated by the Trydood team. You cannot sign in or make changes until it is restored. Your existing brand page and vouchers remain live for customers, and nothing has been deleted. Please contact support if you believe this is a mistake.`,
    meta: brandMeta(brand, identity, {
      reason: reason || null,
      hiddenFromCustomers: Boolean(hiddenFromCustomers),
    }),
    // Push is off on purpose: the vendor's devices are retired by the same
    // operation, so a push would be racing its own token being switched off.
    // Email and WhatsApp are the channels that actually reach a locked-out
    // account — which is exactly why WhatsApp matters most on this one.
    push: false,
    deepLink: deepLink(PANEL_PATHS.SUPPORT),
    mail: {
      lines: brandLines(identity),
      ctaLabel: "Contact support",
      ctaUrl: vendorUrl(PANEL_PATHS.SUPPORT),
      footnote: hiddenFromCustomers
        ? "Your outlets, vouchers and showcase content are untouched and will return exactly as they were if the account is restored."
        : "Your outlets, vouchers and showcase content are untouched, and customers can still see and use what is already published.",
    },
    awaitDelivery,
    // 2 vars: name, brand. The admin's internal note is not one of them.
    whatsapp: {
      params: [identity.name, identity.brandName],
      urlParam: whatsappUrlParam(PANEL_PATHS.SUPPORT),
    },
  });
};

exports.notifyBrandActivated = async ({ brand, awaitDelivery = false }) => {
  const identity = await resolveBrandIdentity(brand);

  return notify({
    brandId: brand._id,
    type: NOTIFICATION_TYPES.BRAND_ACTIVATED,
    severity: NOTIFICATION_SEVERITY.INFO,
    title: "Your account is active again",
    body: `Good news ${identity.name} — your Trydood account for ${identity.brandName} has been reactivated. Please sign in again to continue; for security, any session that was open before this has been ended.`,
    meta: brandMeta(brand, identity),
    deepLink: deepLink(PANEL_PATHS.DASHBOARD),
    mail: {
      lines: brandLines(identity),
      ctaLabel: "Sign in",
      ctaUrl: vendorUrl(PANEL_PATHS.DASHBOARD),
    },
    awaitDelivery,
    // 2 vars: name, brand.
    whatsapp: {
      params: [identity.name, identity.brandName],
      urlParam: whatsappUrlParam(PANEL_PATHS.DASHBOARD),
    },
  });
};

/**
 * Visibility changed on its own — the vendor still has full access, so this is a
 * warning about their reach rather than a lockout.
 */
exports.notifyBrandCustomerVisibilityChanged = async ({
  brand,
  isVisible,
  awaitDelivery = false,
}) => {
  const identity = await resolveBrandIdentity(brand);

  return notify({
    brandId: brand._id,
    type: isVisible
      ? NOTIFICATION_TYPES.BRAND_VISIBLE_TO_CUSTOMERS
      : NOTIFICATION_TYPES.BRAND_HIDDEN_FROM_CUSTOMERS,
    severity: isVisible
      ? NOTIFICATION_SEVERITY.INFO
      : NOTIFICATION_SEVERITY.WARNING,
    title: isVisible
      ? "Your brand is visible to customers again"
      : "Your brand has been hidden from the customer app",
    body: isVisible
      ? `${identity.name}, ${identity.brandName} is being shown to customers again — your brand page, directory listing and showcase are all back.`
      : `Hi ${identity.name}, the Trydood team has removed ${identity.brandName} from the customer app — the brand page, directory listing and showcase. You still have full access to your dashboard, and nothing has been deleted. Please contact support to know more.`,
    meta: brandMeta(brand, identity, {
      isVisibleToCustomers: Boolean(isVisible),
    }),
    deepLink: deepLink(isVisible ? PANEL_PATHS.DASHBOARD : PANEL_PATHS.SUPPORT),
    mail: {
      lines: brandLines(identity),
      ctaLabel: isVisible ? "Open your dashboard" : "Contact support",
      ctaUrl: vendorUrl(
        isVisible ? PANEL_PATHS.DASHBOARD : PANEL_PATHS.SUPPORT,
      ),
    },
    awaitDelivery,
    // 2 vars: name, brand.
    whatsapp: {
      params: [identity.name, identity.brandName],
      urlParam: whatsappUrlParam(
        isVisible ? PANEL_PATHS.DASHBOARD : PANEL_PATHS.SUPPORT,
      ),
    },
  });
};
