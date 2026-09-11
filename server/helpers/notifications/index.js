const { notify } = require("./notify");
const { notifyAdmins } = require("./notifyAdmins");
const { assertReachableAdmins } = require("./assertReachableAdmins");
const { notifyAudience } = require("./notifyAudience");
const { resolveAudience } = require("./resolveAudience");
const { logChannelStatus } = require("./logChannelStatus");
const {
  notifyBrandUnderReview,
  notifyBrandApproved,
  notifyBrandRejected,
  notifyBrandApprovalRevoked,
  notifyAdminsBrandAwaitingReview,
} = require("./brandVerificationNotices");
const {
  PANEL_PATHS,
  ADMIN_PATHS,
  vendorUrl,
  adminUrl,
  deepLink,
  documentUrl,
  invoiceUrl,
} = require("./panelLinks");
const {
  formatDate,
  formatDateTime,
  formatDateRange,
} = require("./formatDateTime");
const {
  resolveChannelPreferences,
  describeChannelPreferences,
} = require("./channelPreferences");
const { resolveAudienceChannels } = require("./audienceChannels");
const {
  notifySubscriptionActivated,
  notifySubscriptionExpiring,
  notifySubscriptionExpired,
  notifySubscriptionCancelled,
} = require("./subscriptionNotices");
const {
  notifyBrandDeactivated,
  notifyBrandActivated,
  notifyBrandCustomerVisibilityChanged,
} = require("./brandStatusNotices");

const refundNotices = require("./refundNotices");
const settlementNotices = require("./settlementNotices");
const indexNotices = require("./indexNotices");
const disputeNotices = require("./disputeNotices");

const { sendQuietly } = require("./sendQuietly");

module.exports = {
  sendQuietly,
  // Refund notices, one per state somebody can act on.
  ...refundNotices,
  // Settlement notices, on the same rule — three to the vendor, three to the
  // admin, and nothing for a state nobody can act on.
  ...settlementNotices,
  ...indexNotices,
  ...disputeNotices,
  notify,
  notifyAdmins,
  /**
   * An admin with no verified address has no outbound channel at all — WhatsApp
   * is off for that audience platform-wide — so their money alerts go in-app
   * only, silently. Run at boot; reports and never acts.
   */
  assertReachableAdmins,
  notifyAudience,
  resolveAudience,
  logChannelStatus,
  // Brand onboarding / verification lifecycle.
  notifyBrandUnderReview,
  notifyBrandApproved,
  notifyBrandRejected,
  notifyBrandApprovalRevoked,
  notifyAdminsBrandAwaitingReview,
  // Where a notice sends the reader. Exported so a caller building its own
  // notice links to the same named screens instead of typing a path.
  PANEL_PATHS,
  ADMIN_PATHS,
  vendorUrl,
  adminUrl,
  deepLink,
  // The public document link, by token. One route serves all six document
  // kinds, so every caller that hands somebody a download builds it from here.
  documentUrl,
  invoiceUrl,
  // The one IST formatter. Every user-facing timestamp goes through it, so a
  // caller reaching past this barrel is a caller about to invent a second
  // date format — which is the bug this module was written to end.
  formatDate,
  formatDateTime,
  formatDateRange,
  // Who may be told what, and on which channel.
  resolveChannelPreferences,
  describeChannelPreferences,
  resolveAudienceChannels,
  notifySubscriptionActivated,
  notifySubscriptionExpiring,
  notifySubscriptionExpired,
  notifySubscriptionCancelled,
  notifyBrandDeactivated,
  notifyBrandActivated,
  notifyBrandCustomerVisibilityChanged,
  // Everything a voucher claim tells someone. All failure-tolerant.
  ...require("./voucherClaimNotices"),
};
