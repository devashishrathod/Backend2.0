// Sections of the pre-approval onboarding funnel (basic details → PAN → GST →
// Bank → system verify).
//
// These label the audit trail during remediation — they are NOT access-control
// units. Once a brand is rejected, the whole pre-approval block reopens
// together on the single "Update Details" page, and the vendor fixes whatever
// the admin's message asked for.
const BRAND_ONBOARDING_SECTION = Object.freeze({
  BASIC_DETAILS: "BASIC_DETAILS",
  PAN: "PAN",
  GST: "GST",
  BANK: "BANK",
});

// Which write window a brand's onboarding data is in.
const BRAND_ONBOARDING_EDIT_MODE = Object.freeze({
  // No system verification has run yet — the original forward-only funnel,
  // where each save advances user.currentScreen to the next step.
  FIRST_PASS: "FIRST_PASS",
  // Rejected or revoked. Everything up to system-verify is editable again, but
  // the vendor stays parked on the UNDER_REVIEW screen and currentScreen is
  // never advanced — the fix page is a sub-flow, not a step.
  REMEDIATION: "REMEDIATION",
  // Waiting on an admin decision, or already approved. Writes are refused so a
  // paid third-party verification can't be burned while nothing is actionable.
  LOCKED: "LOCKED",
});

// How a document-backed section changed on save, for the history row.
const BRAND_ONBOARDING_CHANGE_TYPE = Object.freeze({
  // Same document number re-submitted — the record was updated in place.
  UPDATED: "UPDATED",
  // A different number was submitted — the old record was retired and a new
  // one created.
  REPLACED: "REPLACED",
});

module.exports = {
  BRAND_ONBOARDING_SECTION,
  BRAND_ONBOARDING_EDIT_MODE,
  BRAND_ONBOARDING_CHANGE_TYPE,
};
