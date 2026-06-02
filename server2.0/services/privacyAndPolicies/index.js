const { createPrivacyAndPolicy } = require("./createPrivacyAndPolicy");
const { getAllPrivacyAndPolicies } = require("./getAllPrivacyAndPolicies");
const { getPrivacyAndPolicy } = require("./getPrivacyAndPolicy");
const { updatePrivacyAndPolicy } = require("./updatePrivacyAndPolicy");
const { deletePrivacyAndPolicy } = require("./deletePrivacyAndPolicy");

module.exports = {
  createPrivacyAndPolicy,
  getAllPrivacyAndPolicies,
  getPrivacyAndPolicy,
  updatePrivacyAndPolicy,
  deletePrivacyAndPolicy,
};
