const { addOrUpdateBasicDetails } = require("./addOrUpdateBasicDetails");
const { addPanDetails } = require("./addPanDetails");
const { addGstDetails } = require("./addGstDetails");
const { addBankDetails } = require("./addBankDetails");
const { verifyBrand } = require("./verifyBrand");
const { acceptPartnershipDeed } = require("./acceptPartnershipDeed");
const { get } = require("./get");
const { getCustomer } = require("./getCustomer");
const { getAllCustomer } = require("./getAllCustomer");
const { getAllAdmin } = require("./getAllAdmin");
const { toggleStatus } = require("./toggleStatus");
const { update } = require("./update");
const { reviewBrandVerification } = require("./reviewBrandVerification");
const { reviewTopBrand } = require("./reviewTopBrand");
const { getTopBrands } = require("./getTopBrands");
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
  getAllCustomer,
  getAllAdmin,
  toggleStatus,
  update,
  reviewBrandVerification,
  reviewTopBrand,
  getTopBrands,
  acknowledgeApproval,
  getVerificationHistory,
  getAllVerifications,
};
