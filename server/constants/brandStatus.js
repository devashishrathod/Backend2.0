/**
 * Admin activation / deactivation of a brand account, and the admin brand list.
 *
 * Deliberately separate from `constants/brandVerification.js`: verification asks
 * whether a brand's documents pass KYC, this asks whether the account is allowed
 * to operate at all. The two lifecycles never overlap — an approved brand can be
 * deactivated, and a deactivated brand keeps its approval — so a shared enum
 * would only invite one to be read as the other.
 */

/**
 * Append-only audit actions.
 *
 * Two independent switches, so four actions — and **one history row per switch
 * that actually moved**. A call that flips both writes two rows rather than one
 * ambiguous row, which is what keeps "when was this brand hidden?" answerable
 * separately from "when was the vendor locked out?".
 *
 *  ACCOUNT_*   → `User.isActive`. The vendor can or cannot sign in and act.
 *                Does not touch anything a customer sees.
 *  CUSTOMER_*  → `Brand.isActive`. The brand's profile, directory entry and
 *                showcase are or are not served to customers. Does not affect
 *                the vendor's own access.
 */
const BRAND_STATUS_ACTION = Object.freeze({
  ACCOUNT_ACTIVATED: "ACCOUNT_ACTIVATED",
  ACCOUNT_DEACTIVATED: "ACCOUNT_DEACTIVATED",
  CUSTOMER_VISIBILITY_SHOWN: "CUSTOMER_VISIBILITY_SHOWN",
  CUSTOMER_VISIBILITY_HIDDEN: "CUSTOMER_VISIBILITY_HIDDEN",
});

// Who performed the flip. SYSTEM exists for future unattended jobs (a lapsed
// brand sweep); today every row is ADMIN.
const BRAND_STATUS_ACTOR = Object.freeze({
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM",
});

const BRAND_STATUS_LIMITS = Object.freeze({
  MAX_REASON_LENGTH: 1000,
});

const BRAND_LIST_SORT_BY = Object.freeze({
  NEWEST: "NEWEST",
  OLDEST: "OLDEST",
  NAME: "NAME",
  FOLLOWERS: "FOLLOWERS",
  // Plan usage — which brands are actually working the platform.
  VOUCHERS: "VOUCHERS",
  OUTLETS: "OUTLETS",
  // Renewal worklist: whose plan lapses first.
  SUBSCRIPTION_END: "SUBSCRIPTION_END",
  // Most recently activated / deactivated first — the moderation worklist.
  STATUS_CHANGED: "STATUS_CHANGED",
});

const BRAND_LIST_SORT_ORDER = Object.freeze({
  ASC: "ASC",
  DESC: "DESC",
});

module.exports = {
  BRAND_STATUS_ACTION,
  BRAND_STATUS_ACTOR,
  BRAND_STATUS_LIMITS,
  BRAND_LIST_SORT_BY,
  BRAND_LIST_SORT_ORDER,
};
