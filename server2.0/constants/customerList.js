/**
 * The admin panel's customer directory.
 *
 * Its own file rather than an addition to `constants/customer.js`: everything in
 * that one is a **platform setting fallback** overridden by `Setting.customer`,
 * and nothing there should be read directly. These are enums the validator and
 * the list pipeline read at face value, so mixing them in would make that rule
 * ambiguous the first time somebody looked for it.
 */

/**
 * Orderings the list offers.
 *
 * ⚠️ Every one of these sorts a field that lives on the **customer row or the
 * joined user** — never on a statistic.
 *
 * That is a consequence of how the list is built, not an oversight. The claim,
 * refund, follow and promo figures are fetched for the **ten to a hundred rows
 * of the current page** and merged afterwards, precisely so the cost of the list
 * is bounded by the page rather than by how many customers the platform has.
 * Sorting by lifetime spend would mean computing lifetime spend for every
 * customer who matched the filter, on every page request, which is the one
 * property this shape exists to avoid.
 *
 * So "top spenders" is deliberately not here. When it is genuinely needed it
 * wants a denormalised counter on `Customer` maintained by the settle path — the
 * same way `Brand.vouchersUsed` mirrors its pool — not a sort option that
 * quietly makes the directory unusable.
 */
const CUSTOMER_LIST_SORT_BY = Object.freeze({
  NEWEST: "NEWEST",
  OLDEST: "OLDEST",
  NAME: "NAME",
  // Balances an admin is asked about in support conversations.
  WALLET: "WALLET",
  T_COINS: "T_COINS",
  // Who is actually bringing people in.
  REFERRALS: "REFERRALS",
  // Whose profile moved most recently — the "who is active" scan.
  RECENTLY_UPDATED: "RECENTLY_UPDATED",
});

const CUSTOMER_LIST_SORT_ORDER = Object.freeze({
  ASC: "ASC",
  DESC: "DESC",
});

const CUSTOMER_LIST_LIMITS = Object.freeze({
  MAX_SEARCH_LENGTH: 120,
  MAX_PAGE_SIZE: 100,
  DEFAULT_PAGE_SIZE: 10,
  MAX_CITY_LENGTH: 80,
});

/**
 * The detail screen's sub-lists.
 *
 * Every embedded list is capped and reports its own `total` beside the rows, so
 * a customer with four hundred claims returns a page an admin can read rather
 * than a response the panel has to stream. The full lists already have their own
 * endpoints — `/voucherClaims`, `/refunds`, `/follows` — and this one exists to
 * answer "who is this person" in a single call, not to replace them.
 */
const CUSTOMER_DETAIL_LIMITS = Object.freeze({
  DEFAULT_RECENT: 10,
  MAX_RECENT: 50,
  // Where their money actually goes. Five is a summary; more is a report.
  TOP_BRANDS: 5,
});

/**
 * Why an admin is looking at `canRequestRefund: false`.
 *
 * A code beside the customer-facing sentence, because the sentence is written
 * for the customer and deliberately says "write to support" rather than naming
 * the rule. An admin needs to know *which* limit bit — one is "wait for the open
 * one to finish", the other is "this account has been refused three times this
 * month" — and those lead to completely different next steps.
 */
const REFUND_BLOCK_REASON = Object.freeze({
  OPEN_LIMIT_REACHED: "OPEN_LIMIT_REACHED",
  REFUSAL_LIMIT_REACHED: "REFUSAL_LIMIT_REACHED",
});

module.exports = {
  CUSTOMER_LIST_SORT_BY,
  CUSTOMER_LIST_SORT_ORDER,
  CUSTOMER_LIST_LIMITS,
  CUSTOMER_DETAIL_LIMITS,
  REFUND_BLOCK_REASON,
};
