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
  // Everything a voucher claim tells someone. All failure-tolerant.
  ...require("./voucherClaimNotices"),
};
