const { notify } = require("./notify");
const { notifyAdmins } = require("./notifyAdmins");
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
} = require("./panelLinks");
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

module.exports = {
  notify,
  notifyAdmins,
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
  notifySubscriptionActivated,
  notifySubscriptionExpiring,
  notifySubscriptionExpired,
  notifySubscriptionCancelled,
  notifyBrandDeactivated,
  notifyBrandActivated,
  notifyBrandCustomerVisibilityChanged,
};
