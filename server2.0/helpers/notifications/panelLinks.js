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
  // Where a vendor reads what they have been paid, and chases what they
  // have not.
  SETTLEMENTS: "settlements",
  settlement: (settlementId) => `settlements/${settlementId}`,
  /**
   * Where a vendor sees a chargeback on one of their sales, and can add what only
   * they have — the kitchen ticket, a camera timestamp, what the staff remember.
   *
   * ⚠️ Before this existed the vendor was told nothing at all: the money simply
   * stopped appearing in a settlement, and later a line on a statement deducted
   * it. Same warning as the admin paths — a missing key here links to the word
   * "undefined" and nobody finds out until somebody taps one.
   */
  DISPUTES: "disputes",
  dispute: (disputeId) => `disputes/${disputeId}`,
  SUPPORT: "support",
});

/** Admin-side screens, for the notices that ask an admin to act. */
const ADMIN_PATHS = Object.freeze({
  BRAND_VERIFICATION: "brands/verification",
  brandVerification: (brandId) => `brands/verification/${brandId}`,
  /**
   * The refund worklist.
   *
   * ⚠️ A missing key here does not throw — it produces `undefined`, which
   * `deepLink` turns into a link ending in "undefined". The notification still
   * sends and still looks fine; it just goes nowhere, and nobody finds out until
   * an admin taps one.
   */
  REFUNDS: "refunds",
  refund: (requestId) => `refunds/${requestId}`,
  // The payout worklist. Same warning as above: a missing key here links to
  // the word "undefined" and nobody finds out until an admin taps one.
  SETTLEMENTS: "settlements",
  settlement: (settlementId) => `settlements/${settlementId}`,
  /**
   * The dispute worklist, served by `GET /transactions/disputes`.
   *
   * Keyed on the **transaction**, because there is no `Dispute` model yet — a
   * dispute lives as denormalised fields on the payment it belongs to (S3-1).
   * Same warning as above: a missing key here links to the word "undefined".
   */
  DISPUTES: "disputes",
  dispute: (transactionId) => `disputes/${transactionId}`,
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

/**
 * Customer-app screens.
 *
 * The customer app resolves its own routes, so these are bare paths — there is
 * no customer web panel to build an absolute URL against.
 */
const CUSTOMER_PATHS = Object.freeze({
  ORDERS: "orders",
  order: (claimId) => `orders/${claimId}`,
  transaction: (transactionId) => `transactions/${transactionId}`,
  voucher: (voucherId) => `vouchers/${voucherId}`,
  /**
   * Where a customer adds a bank account when a refund cannot go back the way it
   * came. ⚠️ An app route, never a web form: the one notice that asks for bank
   * details must not also hand out a link that could collect them.
   */
  REFUNDS: "refunds",
  refund: (requestId) => `refunds/${requestId}`,
  SUPPORT: "support",
});

/**
 * An absolute link to something this API itself serves.
 *
 * Used for the invoice download, which is the one customer-facing URL that is
 * **not** an app route: it resolves a token and redirects to a CDN file, so it
 * has to be reachable from a WhatsApp message and an email client.
 *
 * Returns `undefined` when `PUBLIC_API_URL` is unset — the same contract
 * `vendorUrl` follows, so `sendMail` omits the button rather than rendering a
 * dead one. A Download button that goes nowhere is worse than no button.
 *
 * ⚠️ The WhatsApp template's URL button is approved by Meta **against a fixed
 * base**, with only the last segment dynamic. That is why the token is the last
 * path segment and the Cloudinary URL is not used directly: a CDN URL is
 * different for every invoice and could never be the dynamic part.
 */
const publicUrl = (path) => {
  const base = trimBase(process.env.PUBLIC_API_URL);
  if (!base) return undefined;
  return `${base}/trydood/v1/${trimPath(path)}`;
};

/** The public invoice link, by token. */
const invoiceUrl = (token) =>
  token ? publicUrl(`transactions/invoice/${token}`) : undefined;

module.exports = {
  CUSTOMER_PATHS,
  publicUrl,
  invoiceUrl,
  PANEL_PATHS,
  ADMIN_PATHS,
  vendorUrl,
  adminUrl,
  deepLink,
  whatsappUrlParam,
};
