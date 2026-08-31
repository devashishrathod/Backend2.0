const { getSetting } = require("./getSetting");
const { getVoucherConfig } = require("./getVoucherConfig");
const { getShowcaseConfig } = require("./getShowcaseConfig");
const { getSubscriptionConfig } = require("./getSubscriptionConfig");
const { getCustomerConfig } = require("./getCustomerConfig");
const { assertSettlementTimingRule } = require("./assertSettlementTimingRule");

module.exports = {
  getSetting,
  getVoucherConfig,
  getShowcaseConfig,
  getSubscriptionConfig,
  getCustomerConfig,
  // Not a getter: the cross-block rule that `updateSetting` runs on the merged
  // document before saving.
  assertSettlementTimingRule,
};
