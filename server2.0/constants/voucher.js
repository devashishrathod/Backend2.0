const VOUCHER_USAGE_TYPE = Object.freeze({
  ONCE_PER_USER: "ONCE_PER_USER",
  MULTIPLE: "MULTIPLE",
});

const DISCOUNT_APPLICABLE_ON = Object.freeze({
  SUBTOTAL: "SUBTOTAL",
  FINAL_BILL: "FINAL_BILL",
});

const VOUCHER_SORT_BY = Object.freeze({
  DISTANCE: "DISTANCE",
  NEWEST: "NEWEST",
  EXPIRING_SOON: "EXPIRING_SOON",
  RELEVANCE: "RELEVANCE",
});

const VOUCHER_SORT_ORDER = Object.freeze({
  ASC: "ASC",
  DESC: "DESC",
});

const VOUCHER_APPROVAL_ACTION = Object.freeze({
  SUBMITTED: "SUBMITTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PAUSED: "PAUSED",
  RESUMED: "RESUMED",
  ARCHIVED: "ARCHIVED",
  EXPIRED: "EXPIRED",
  PUBLISHED: "PUBLISHED",
});

const VOUCHER_STATUSES = Object.freeze({
  DRAFT: "DRAFT",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
  PUBLISHED: "PUBLISHED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  PAUSED: "PAUSED",
  ARCHIVED: "ARCHIVED",
});

const VOUCHER_OFFER_LIMITS = Object.freeze({
  MAX_IMAGES: 5,
  MAX_OFFERS: 10,
  MAX_DISTANCE: 10000,
});

const VOUCHER_DISCOUNT_TYPES = Object.freeze({
  PERCENTAGE: "PERCENTAGE",
  FIXED: "FIXED",
  FLAT: "FLAT",
});

/**
 * Statuses that count against the plan's voucher limit.
 *
 * A voucher that has run its course — expired, archived, or rejected — releases
 * its slot, so a vendor does not have to delete history to create something new.
 * Everything still in play (drafts, in review, approved, live, paused) holds one.
 */
const VOUCHER_SLOT_CONSUMING_STATUSES = Object.freeze([
  VOUCHER_STATUSES.DRAFT,
  VOUCHER_STATUSES.UNDER_REVIEW,
  VOUCHER_STATUSES.APPROVED,
  VOUCHER_STATUSES.PUBLISHED,
  VOUCHER_STATUSES.PAUSED,
]);

// The complement, kept explicit so a new status added to VOUCHER_STATUSES shows
// up as uncategorised rather than silently freeing a slot.
const VOUCHER_SLOT_RELEASING_STATUSES = Object.freeze([
  VOUCHER_STATUSES.EXPIRED,
  VOUCHER_STATUSES.ARCHIVED,
  VOUCHER_STATUSES.REJECTED,
]);

/**
 * The rows a voucher-claim checkout renders, top to bottom.
 *
 * Keyed rather than positional so a client can style or reorder without parsing
 * the label — and so a new row can be inserted without shifting anything.
 *
 * Deliberately NOT reusing `ORDER_SUMMARY_ROWS` from the subscription side. The
 * two checkouts show different things: there is no "Original Price" for a bill
 * the customer typed, and a subscription has no convenience fee. Sharing the
 * enum would mean one of them carrying keys it never emits, and a client
 * switching on it could not tell which flow it was rendering.
 */
const VOUCHER_SUMMARY_ROWS = Object.freeze({
  BILL_AMOUNT: "BILL_AMOUNT",
  OFFER_DISCOUNT: "OFFER_DISCOUNT",
  PROMO_DISCOUNT: "PROMO_DISCOUNT",
  NET_BILL: "NET_BILL",
  CONVENIENCE_FEE: "CONVENIENCE_FEE",
  TAX: "TAX",
});

/**
 * Why a specific offer could not be applied.
 *
 * Only reached when the customer **named** an offer. When nobody named one, an
 * offer that does not fit is simply not chosen — that is ranking, not a refusal,
 * and saying "this offer needs a bigger bill" about an offer they never asked
 * for would be noise.
 *
 * Values are the message, not a code — the same convention as `PROMO_REJECTION`,
 * so a client can show them directly.
 */
const OFFER_REJECTION = Object.freeze({
  NOT_FOUND: "That offer is not available on this voucher.",
  INACTIVE: "That offer is no longer available.",
  ALREADY_USED: "You have already used this offer.",
  NO_DISCOUNT: "That offer gives no discount on this bill.",
});

/** The one message that needs the number in it to be useful. */
const offerBelowMinimum = (minBillAmount, symbol = "₹") =>
  `This offer needs a bill of at least ${symbol}${Number(minBillAmount || 0).toLocaleString("en-IN")}.`;

module.exports = {
  OFFER_REJECTION,
  offerBelowMinimum,
  VOUCHER_SUMMARY_ROWS,
  VOUCHER_SLOT_CONSUMING_STATUSES,
  VOUCHER_SLOT_RELEASING_STATUSES,
  VOUCHER_USAGE_TYPE,
  DISCOUNT_APPLICABLE_ON,
  VOUCHER_SORT_BY,
  VOUCHER_SORT_ORDER,
  VOUCHER_APPROVAL_ACTION,
  VOUCHER_STATUSES,
  VOUCHER_OFFER_LIMITS,
  VOUCHER_DISCOUNT_TYPES,
};
