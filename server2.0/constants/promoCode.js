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
  REPORT_GROUP_BY,
  REPORT_LIMITS,
  PROMO_APPLICABLE_ACTIONS,
  PROMO_USAGE_STATUS,
  PROMO_CODE_LIMITS,
  PROMO_REJECTION,
};
