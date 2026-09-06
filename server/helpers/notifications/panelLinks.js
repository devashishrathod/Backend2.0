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
  /**
   * ---------- the screens behind the inline alerts ----------
   *
   * ⚠️ These exist because eleven admin alerts had **no button and no detail
   * table at all**: `WEBHOOK_FAILED` (nine separate faults sharing one type),
   * `PAYMENT_DISPUTED` and `PROMO_LIMIT_EXCEEDED` are raised inline from the
   * services rather than from a notice helper, and were sent as a bare heading
   * and paragraph. Each one names a record — a payment charged twice, an offer
   * redeemed twice, a code past its cap — and gave no way to open it.
   *
   * Same warning as every path above: a missing key here does not throw, it
   * produces a link ending in the word "undefined", and nobody finds out until
   * an admin taps one.
   */
  TRANSACTIONS: "transactions",
  transaction: (transactionId) => `transactions/${transactionId}`,
  CLAIMS: "voucherclaims",
  claim: (claimId) => `voucherclaims/${claimId}`,
  // Keyed on the **code**, not an id: every alert about a promo knows the code,
  // and it is what an admin searches by.
  PROMOS: "promos",
  promo: (code) => `promos/${code}`,
  // The stored webhook payloads, which is where a failed delivery is replayed from.
  WEBHOOKS: "webhooks",
  webhook: (webhookEventId) => `webhooks/${webhookEventId}`,
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
 * An absolute link into the customer app, for an email button.
 *
 * ### Why this is not just another panel URL
 *
 * A vendor and an admin read their notice in a browser, so `vendorUrl` and
 * `adminUrl` point at a web app. A customer's destination is a **mobile app
 * screen**, and an email cannot open one directly — so `CUSTOMER_APP_URL` is
 * expected to be a **universal / app link** host (`https://app.trydood.com`)
 * verified for both platforms:
 *
 * - Android — `/.well-known/assetlinks.json` served at that host
 * - iOS — `/.well-known/apple-app-site-association` served at that host
 *
 * With those in place the tap opens the app at the matching route, and the app's
 * own auth guard decides whether that is the screen or the login screen. Nothing
 * here needs to know: the URL is the destination, not the flow. ⚠️ Which is also
 * why no `?next=` is appended — the route *is* the next.
 *
 * ### ⚠️ What this cannot do
 *
 * If the app is **not installed**, the tap opens that https URL in a browser —
 * so sending the reader on to the Play Store or the App Store has to be done by
 * whatever is served at `CUSTOMER_APP_URL`, by sniffing the user agent. The
 * backend only emits the address. There is no way to express "…and if it is not
 * installed, go to the store" inside a link.
 *
 * Unset, this returns `undefined` and the button is omitted — the same contract
 * `vendorUrl` follows, and the reason is the same: a customer tapping a link
 * that goes nowhere is worse than an email with no button. The boot log names it
 * when it is missing.
 */
const customerUrl = (path) => {
  const base = trimBase(process.env.CUSTOMER_APP_URL);
  if (!base) return undefined;

  /**
   * ⚠️ A store link is not a base, and this is the mistake it is here to catch.
   *
   * "If the app is not installed, send them to the Play Store" reads like an
   * instruction about *this* variable, and the obvious thing to put in it is the
   * store URL. Joining a route onto one produces:
   *
   *     https://play.google.com/store/apps/details?id=com.trydood/orders/<id>
   *                                                             └── after the query string
   *
   * which reaches neither the app screen nor the store listing. It is a link that
   * looks configured and goes nowhere — the exact failure the rest of this file
   * exists to avoid, so the button is dropped and the reason is named.
   *
   * The store fallback belongs to whatever is *served at* the universal-link
   * host, decided there from the user agent. It cannot be expressed in a URL.
   */
  if (base.includes("?") || base.includes("#")) {
    warnBaseOnce(
      `CUSTOMER_APP_URL carries a query string (${base}). It must be a bare universal-link host such as https://app.trydood.com — a route is appended to it, so a store or tracking URL produces a broken link. Customer email buttons are omitted.`,
    );
    return undefined;
  }

  return `${base}/${trimPath(path)}`;
};

/**
 * A misconfigured base is one fact about the environment, not one per email.
 *
 * Every customer notice calls `customerUrl`, so an unguarded warning would print
 * once per message and bury everything else in the log.
 */
const warnedBases = new Set();
const warnBaseOnce = (message) => {
  if (warnedBases.has(message)) return;
  warnedBases.add(message);
  console.warn(`[panelLinks] ${message}`);
};

/**
 * Customer-app screens.
 *
 * Bare paths, because the app resolves its own routes — `deepLink` uses them as
 * they are, and `customerUrl` above joins them onto the universal-link host for
 * an email button.
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

/**
 * The public link to **any** Trydood document, by token.
 *
 * One route for all six kinds — a claim receipt, a subscription invoice, a grant
 * advice, a payout statement, a refund receipt, a chargeback advice. The resolver
 * behind it works out which collection the token belongs to.
 *
 * ⚠️ There used to be two routes — `/transactions/invoice/:token` and
 * `/settlements/statement/:token` — and a refund or a dispute would have needed a
 * third and a fourth. Worse, each carried its own token field name, so nothing
 * could resolve a token without first knowing what kind of document it was, which
 * is the one thing a bare token cannot tell you.
 */
const documentUrl = (token) =>
  token ? publicUrl(`documents/${token}`) : undefined;

/**
 * @deprecated Use `documentUrl`. Kept as an alias so a link already sent in an
 * email or a WhatsApp message resolves to the same place; both produce the new
 * route.
 */
const invoiceUrl = documentUrl;

module.exports = {
  CUSTOMER_PATHS,
  publicUrl,
  documentUrl,
  invoiceUrl,
  PANEL_PATHS,
  ADMIN_PATHS,
  vendorUrl,
  adminUrl,
  customerUrl,
  deepLink,
  whatsappUrlParam,
};
