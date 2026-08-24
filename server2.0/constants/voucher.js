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

module.exports = {
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
