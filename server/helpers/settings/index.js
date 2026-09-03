const { getSetting } = require("./getSetting");
const { getVoucherConfig } = require("./getVoucherConfig");
const { getShowcaseConfig } = require("./getShowcaseConfig");
const { getSubscriptionConfig } = require("./getSubscriptionConfig");
const { getCustomerConfig } = require("./getCustomerConfig");
const { getSecurityConfig } = require("./getSecurityConfig");
const { assertSettlementTimingRule } = require("./assertSettlementTimingRule");

module.exports = {
  getSetting,
  getVoucherConfig,
  getShowcaseConfig,
  getSubscriptionConfig,
  getCustomerConfig,
  // Not one audience's — OTP limits apply to whoever is logging in.
  getSecurityConfig,
  // Not a getter: the cross-block rule that `updateSetting` runs on the merged
  // document before saving.
  assertSettlementTimingRule,
};
