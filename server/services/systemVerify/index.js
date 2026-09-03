const { verifyVendor } = require("./verifyVendor");
const { reviewBrandVerification } = require("./reviewBrandVerification");
const { acknowledgeBrandApproval } = require("./acknowledgeBrandApproval");
const {
  getBrandVerificationHistory,
} = require("./getBrandVerificationHistory");
const { getAllBrandVerifications } = require("./getAllBrandVerifications");

module.exports = {
  verifyVendor,
  reviewBrandVerification,
  acknowledgeBrandApproval,
  getBrandVerificationHistory,
  getAllBrandVerifications,
};
