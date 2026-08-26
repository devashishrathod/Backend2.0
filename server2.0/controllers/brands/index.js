const { addOrUpdateBasicDetails } = require("./addOrUpdateBasicDetails");
const { addPanDetails } = require("./addPanDetails");
const { addGstDetails } = require("./addGstDetails");
const { addBankDetails } = require("./addBankDetails");
const { verifyBrand } = require("./verifyBrand");
const { acceptPartnershipDeed } = require("./acceptPartnershipDeed");
const { get } = require("./get");
const { getCustomer } = require("./getCustomer");
const { update } = require("./update");
const { reviewBrandVerification } = require("./reviewBrandVerification");
const { acknowledgeApproval } = require("./acknowledgeApproval");
const { getVerificationHistory } = require("./getVerificationHistory");
const { getAllVerifications } = require("./getAllVerifications");

module.exports = {
  addOrUpdateBasicDetails,
  addPanDetails,
  addGstDetails,
  addBankDetails,
  verifyBrand,
  acceptPartnershipDeed,
  get,
  getCustomer,
  update,
  reviewBrandVerification,
  acknowledgeApproval,
  getVerificationHistory,
  getAllVerifications,
};
