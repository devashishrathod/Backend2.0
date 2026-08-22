// Every audit-trail event that can happen on a brand's verification lifecycle.
// One history row per event — a re-rejection creates a brand new row, it never
// overwrites the previous one.
const BRAND_VERIFICATION_ACTION = Object.freeze({
  SYSTEM_VERIFIED: "SYSTEM_VERIFIED", // first automatic system run
  RESUBMITTED: "RESUBMITTED", // vendor re-ran system verify after a rejection
  REVIEWED: "REVIEWED", // admin toggled the "seen/reviewed" flag ON
  UNREVIEWED: "UNREVIEWED", // admin toggled the "seen/reviewed" flag OFF
  APPROVED: "APPROVED", // admin approved the brand
  REJECTED: "REJECTED", // admin rejected the brand (reason mandatory)
  REVOKED: "REVOKED", // admin withdrew an approval (reason mandatory)
  APPROVAL_ACKNOWLEDGED: "APPROVAL_ACKNOWLEDGED", // vendor dismissed the
  // approval screen and moved on to the dashboard
});

// What an admin is allowed to send to the review API.
const BRAND_VERIFICATION_ADMIN_ACTION = Object.freeze({
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  REVIEWED: "REVIEWED", // toggle-only, never changes the status
  REVOKED: "REVOKED", // only valid on an already-approved brand
});

// Who performed a history event.
const BRAND_VERIFICATION_ACTOR = Object.freeze({
  SYSTEM: "SYSTEM",
  ADMIN: "ADMIN",
  VENDOR: "VENDOR",
});

const BRAND_VERIFICATION_SORT_BY = Object.freeze({
  NEWEST: "NEWEST",
  OLDEST: "OLDEST",
  SCORE: "SCORE",
});

const BRAND_VERIFICATION_SORT_ORDER = Object.freeze({
  ASC: "ASC",
  DESC: "DESC",
});

const BRAND_VERIFICATION_LIMITS = Object.freeze({
  MAX_REASON_LENGTH: 1000,
  MAX_NOTE_LENGTH: 1000,
});

module.exports = {
  BRAND_VERIFICATION_ACTION,
  BRAND_VERIFICATION_ADMIN_ACTION,
  BRAND_VERIFICATION_ACTOR,
  BRAND_VERIFICATION_SORT_BY,
  BRAND_VERIFICATION_SORT_ORDER,
  BRAND_VERIFICATION_LIMITS,
};
