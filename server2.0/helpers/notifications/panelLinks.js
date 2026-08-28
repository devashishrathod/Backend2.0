/**
 * Where a notification should send the reader.
 *
 * Two different things, resolved in one place:
 *
 *  - **`vendorUrl(path)`** — an absolute URL for an email button. Returns
 *    `undefined` when `VENDOR_PANEL_URL` is unset, which is what `sendMail`
 *    needs to omit the button entirely. A button rendering as a dead `/plans`
 *    link is worse than no button.
 *  - **`deepLink(path)`** — a bare client route for the in-app row and the push
 *    payload. Always returned, because the mobile app resolves its own routes
 *    and does not need a host.
 *
 * Kept together so a screen is named once. When the onboarding route changes,
 * one constant below moves and every channel follows.
 */

/** Trailing slashes on the env value would double up in the joined URL. */
const trimBase = (value) => String(value || "").replace(/\/+$/, "");
const trimPath = (value) => String(value || "").replace(/^\/+/, "");

/**
 * The screens notifications link to. Named rather than inlined so a route
 * rename is one edit, and so a typo is a missing constant instead of a silently
 * broken link in production.
 */
const PANEL_PATHS = Object.freeze({
  ONBOARDING_STATUS: "onboarding/status",
  ONBOARDING_FIX: "onboarding/review",
  DASHBOARD: "dashboard",
  SUBSCRIPTION: "subscription",
  SUBSCRIPTION_PLANS: "subscription/plans",
  SUPPORT: "support",
});

/** Admin-side screens, for the notices that ask an admin to act. */
const ADMIN_PATHS = Object.freeze({
  BRAND_VERIFICATION: "brands/verification",
  brandVerification: (brandId) => `brands/verification/${brandId}`,
});

/**
 * Absolute vendor-panel URL, or `undefined` when the panel URL is not
 * configured — so an email simply renders without its button rather than with a
 * broken one.
 */
const vendorUrl = (path) => {
  const base = trimBase(process.env.VENDOR_PANEL_URL);
  return base ? `${base}/${trimPath(path)}` : undefined;
};

/** Absolute admin-panel URL, or `undefined` when unset. */
const adminUrl = (path) => {
  const base = trimBase(process.env.ADMIN_PANEL_URL);
  return base ? `${base}/${trimPath(path)}` : undefined;
};

/**
 * A client route for the in-app row and the push payload.
 *
 * Always returned: unlike an email button, the app resolves this itself, so it
 * works whether or not a web panel URL is configured.
 */
const deepLink = (path) => `/${trimPath(path)}`;

/**
 * The `URLParam` a WhatsApp template's dynamic URL button receives.
 *
 * Meta approves the button's base URL as part of the template; only the trailing
 * segment is dynamic. So this is a **path fragment, not a full URL** — sending a
 * full URL would produce a doubled host.
 */
const whatsappUrlParam = (path) => trimPath(path);

module.exports = {
  PANEL_PATHS,
  ADMIN_PATHS,
  vendorUrl,
  adminUrl,
  deepLink,
  whatsappUrlParam,
};
