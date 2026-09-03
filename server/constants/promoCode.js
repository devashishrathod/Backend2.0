/**
 * Promo code enums and limits.
 *
 * A promo code discount is applied **on top of** the plan's own discount, to the
 * already-discounted subtotal — never to the list price. GST is then charged on
 * `listPrice - planDiscount - promoDiscount`, which keeps the tax base correct
 * and matches the row order the checkout page renders.
 */

const PROMO_DISCOUNT_TYPES = Object.freeze({
  PERCENT: "PERCENT",
  FLAT: "FLAT",
});

/**
 * Who a code is for.
 *
 * The same collection now serves two completely different checkouts, and they
 * must not see each other's codes: a vendor subscription discount surfacing in
 * the customer app would be given away at the wrong price, and a customer
 * voucher code accepted at subscription checkout would discount the wrong
 * thing. **Both paths filter on this**, not just the customer one.
 *
 * ⚠️ Mongoose applies a schema default on *write*, never to documents that
 * already exist. Every code created before this field existed therefore has no
 * `audience` at all, and `{ audience: "VENDOR" }` would match none of them. The
 * vendor path must query `{ audience: { $ne: CUSTOMER } }`. Every query builds
 * that filter through `helpers/promoCodes/buildAudienceFilter.js` rather than
 * writing it out, so the listing, the report and the checkout validator cannot
 * drift on it; the migration backfills the field.
 */
const PROMO_AUDIENCE = Object.freeze({
  VENDOR: "VENDOR",
  CUSTOMER: "CUSTOMER",
});

/**
 * What a customer-side discount is subtracted from.
 *
 * `NET_BILL` is the vendor's supply after the voucher offer; `CONVENIENCE_FEE`
 * is Trydood's own fee. The discount is clamped to whichever base it applies
 * to — a ₹50 code against a ₹10 fee must take ₹10, not eat ₹40 out of the bill.
 */
const PROMO_APPLIES_TO = Object.freeze({
  NET_BILL: "NET_BILL",
  CONVENIENCE_FEE: "CONVENIENCE_FEE",
});

/**
 * Who funds the discount.
 *
 * The vendor is paid `netBill` minus their share, so this directly changes what
 * a settlement owes. It is frozen onto each claim at checkout, because changing
 * a live code must never retroactively alter what a vendor was already told
 * they would be paid.
 *
 * `VENDOR` and `SHARED` take money out of a specific vendor's pocket, so a code
 * using either **must** be scoped with `brandIds` — otherwise it would deduct
 * from whichever brand a customer happened to visit. Enforced in `assertCoherent`.
 */
const PROMO_COST_BEARING_MODE = Object.freeze({
  PLATFORM: "PLATFORM",
  VENDOR: "VENDOR",
  SHARED: "SHARED",
});

// Which checkout actions a code may be used for. An empty list on the code
// document means "any".
const PROMO_APPLICABLE_ACTIONS = Object.freeze({
  NEW: "NEW",
  RENEW: "RENEW",
  UPGRADE: "UPGRADE",
  DOWNGRADE: "DOWNGRADE",
});

/**
 * A code is claimed in three steps so an abandoned checkout cannot burn a
 * single-use code:
 *   RESERVED  — order created, payment not made yet
 *   CONSUMED  — payment verified, the use is final
 *   RELEASED  — the order failed or expired; the slot went back
 */
const PROMO_USAGE_STATUS = Object.freeze({
  RESERVED: "RESERVED",
  CONSUMED: "CONSUMED",
  RELEASED: "RELEASED",
});

const PROMO_CODE_LIMITS = Object.freeze({
  MIN_CODE_LENGTH: 3,
  MAX_CODE_LENGTH: 40,
  MAX_DESCRIPTION_LENGTH: 300,
  // A RESERVED usage older than this is treated as abandoned and reclaimed by
  // the promo sweep job, so a code is never locked up by a dropped checkout.
  RESERVATION_TTL_MINUTES: 30,
});

// Every rejection reason, so the API returns something the vendor can act on
// rather than a generic "invalid code".
const PROMO_REJECTION = Object.freeze({
  DISABLED: "Promo codes are not available yet. Please continue without one.",
  NOT_FOUND: "This promo code is not valid.",
  INACTIVE: "This promo code is no longer active.",
  NOT_STARTED: "This promo code is not active yet.",
  EXPIRED: "This promo code has expired.",
  PLAN_NOT_ELIGIBLE: "This promo code cannot be used on the selected plan.",
  ACTION_NOT_ELIGIBLE:
    "This promo code cannot be used for this type of purchase.",
  FIRST_TIME_ONLY:
    "This promo code is only valid on a first subscription purchase.",
  MIN_ORDER_VALUE:
    "This promo code requires a higher order value than the selected plan.",
  TOTAL_LIMIT_REACHED: "This promo code has reached its usage limit.",
  BRAND_LIMIT_REACHED: "You have already used this promo code.",

  // ---------- customer-side ----------
  // Deliberately worded exactly like NOT_FOUND. A customer trying a vendor
  // subscription code must not learn that the code exists but is not theirs —
  // that is a discount-code oracle.
  WRONG_AUDIENCE: "This promo code is not valid.",
  VOUCHER_NOT_ELIGIBLE: "This promo code cannot be used on this voucher.",
  BRAND_NOT_ELIGIBLE: "This promo code cannot be used at this brand.",
  CATEGORY_NOT_ELIGIBLE:
    "This promo code cannot be used on this type of voucher.",
  MIN_BILL_AMOUNT: "Your bill is below the minimum for this promo code.",
  CUSTOMER_LIMIT_REACHED: "You have already used this promo code.",
  FIRST_ORDER_ONLY: "This promo code is only valid on your first order.",
  // A promo has nothing to discount when no voucher offer applied.
  NO_OFFER_APPLIED:
    "Promo codes apply only when a voucher offer is active on your bill.",
  // Guest preview: the code is priced in, but the per-customer checks cannot
  // run without knowing who the customer is.
  REQUIRES_LOGIN: "Log in to confirm this promo code.",
});

/**
 * Campaign reporting. The caps keep a report a report: an admin reading it wants
 * the shape of a campaign, and a thousand-row table is a data export, not that.
 */
const REPORT_GROUP_BY = Object.freeze({
  DAY: "day",
  MONTH: "month",
});

const REPORT_LIMITS = Object.freeze({
  MAX_CODES: 100,
  MAX_BRANDS: 25,
  // ~2 years of months, or ~3 months of days.
  MAX_PERIODS: 400,
});

module.exports = {
  PROMO_DISCOUNT_TYPES,
  PROMO_AUDIENCE,
  PROMO_APPLIES_TO,
  PROMO_COST_BEARING_MODE,
  REPORT_GROUP_BY,
  REPORT_LIMITS,
  PROMO_APPLICABLE_ACTIONS,
  PROMO_USAGE_STATUS,
  PROMO_CODE_LIMITS,
  PROMO_REJECTION,
};
