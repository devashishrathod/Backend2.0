const { createVoucher } = require("./createVoucher");
const { updateVoucher } = require("./updateVoucher");
const { submitVoucherForReview } = require("./submitVoucherForReview");
const { reviewVoucher } = require("./reviewVoucher");
const { publishVoucher } = require("./publishVoucher");
const { getAllVoucherVersions } = require("./getAllVoucherVersions");
const { getCustomerVouchers } = require("./getCustomerVouchers");
const { getCustomerSingleVoucher } = require("./getCustomerSingleVoucher");
const { previewCustomerVoucher } = require("./previewCustomerVoucher");
const { setVoucherBanner } = require("./setVoucherBanner");
const { reviewVoucherBanner } = require("./reviewVoucherBanner");

const { reviewVoucherSuggestion } = require("./reviewVoucherSuggestion");
const { getSuggestedVouchers } = require("./getSuggestedVouchers");
const { expireVouchers } = require("./expireVouchers");

module.exports = {
  expireVouchers,
  createVoucher,
  updateVoucher,
  submitVoucherForReview,
  reviewVoucher,
  publishVoucher,
  getAllVoucherVersions,
  getCustomerVouchers,
  getCustomerSingleVoucher,
  previewCustomerVoucher,
  setVoucherBanner,
  reviewVoucherBanner,

  reviewVoucherSuggestion,
  getSuggestedVouchers,
};
