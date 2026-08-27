const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const { notify } = require("./notify");

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
 */

const brandLines = (brand) => [
  ["Brand", brand.brandName || brand.uniqueId || "-"],
  ["Merchant ID", brand.merchantId || "-"],
];

const brandMeta = (brand, extra = {}) => ({
  brandName: brand.brandName,
  brandUniqueId: brand.uniqueId,
  merchantId: brand.merchantId,
  ...extra,
});

/**
 * The vendor lost access. Their brand and vouchers may well still be live for
 * customers — that is a separate switch — so the copy is careful to say what
 * changed and what did not.
 */
exports.notifyBrandDeactivated = ({ brand, reason, hiddenFromCustomers }) =>
  notify({
    brandId: brand._id,
    type: NOTIFICATION_TYPES.BRAND_DEACTIVATED,
    severity: NOTIFICATION_SEVERITY.CRITICAL,
    title: "Your account has been deactivated",
    body: hiddenFromCustomers
      ? "Your Trydood account has been deactivated by the Trydood team, and your brand has been removed from the customer app. You cannot sign in until it is restored. Nothing has been deleted. Please contact support if you believe this is a mistake."
      : "Your Trydood account has been deactivated by the Trydood team. You cannot sign in or make changes until it is restored. Your existing brand page and vouchers remain live for customers, and nothing has been deleted. Please contact support if you believe this is a mistake.",
    meta: brandMeta(brand, {
      reason: reason || null,
      hiddenFromCustomers: Boolean(hiddenFromCustomers),
    }),
    // Push is off on purpose: the vendor's devices are retired by the same
    // operation, so a push would be racing its own token being switched off.
    // Email is the channel that actually reaches a locked-out account.
    push: false,
    mail: {
      lines: brandLines(brand),
      footnote: hiddenFromCustomers
        ? "Your outlets, vouchers and showcase content are untouched and will return exactly as they were if the account is restored."
        : "Your outlets, vouchers and showcase content are untouched, and customers can still see and use what is already published.",
    },
  });

exports.notifyBrandActivated = ({ brand }) =>
  notify({
    brandId: brand._id,
    type: NOTIFICATION_TYPES.BRAND_ACTIVATED,
    severity: NOTIFICATION_SEVERITY.INFO,
    title: "Your account is active again",
    body: "Your Trydood account has been reactivated. Please sign in again to continue — for security, any session that was open before this has been ended.",
    meta: brandMeta(brand),
    mail: { lines: brandLines(brand) },
  });

/**
 * Visibility changed on its own — the vendor still has full access, so this is a
 * warning about their reach rather than a lockout.
 */
exports.notifyBrandCustomerVisibilityChanged = ({ brand, isVisible }) =>
  notify({
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
      ? "Your brand page, directory listing and showcase are being shown to customers again."
      : "The Trydood team has removed your brand page, directory listing and showcase from the customer app. You still have full access to your dashboard, and nothing has been deleted. Please contact support to know more.",
    meta: brandMeta(brand, { isVisibleToCustomers: Boolean(isVisible) }),
    mail: { lines: brandLines(brand) },
  });
