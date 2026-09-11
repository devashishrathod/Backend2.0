const { getSetting } = require("./getSetting");
const { getVoucherConfig } = require("./getVoucherConfig");
const { getShowcaseConfig } = require("./getShowcaseConfig");
const { getSubscriptionConfig } = require("./getSubscriptionConfig");
const { getCustomerConfig } = require("./getCustomerConfig");
const { getAdminConfig } = require("./getAdminConfig");
const { getSecurityConfig } = require("./getSecurityConfig");
const { getAppConfig } = require("./getAppConfig");
const { assertSettlementTimingRule } = require("./assertSettlementTimingRule");
const { assertReserveRateRule } = require("./assertReserveRateRule");

module.exports = {
  getSetting,
  getVoucherConfig,
  getShowcaseConfig,
  getSubscriptionConfig,
  getCustomerConfig,
  // The admin audience's own channel toggles. ⚠️ Before this, admin alerts were
  // governed by the *vendor* block — see the file.
  getAdminConfig,
  // Not one audience's — OTP limits apply to whoever is logging in.
  getSecurityConfig,
  // The only one whose output is public — a whitelist, see the file.
  getAppConfig,
  // Not getters: the cross-field rules `updateSetting` runs on the merged
  // document before saving, because a partial PATCH carries only one side of
  // each comparison.
  assertSettlementTimingRule,
  assertReserveRateRule,
};
