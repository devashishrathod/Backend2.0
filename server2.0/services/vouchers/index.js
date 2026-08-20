const { createVoucher } = require("./createVoucher");
const { updateVoucher } = require("./updateVoucher");
const { submitVoucherForReview } = require("./submitVoucherForReview");
const { reviewVoucher } = require("./reviewVoucher");
const { publishVoucher } = require("./publishVoucher");
const { getAllVoucherVersions } = require("./getAllVoucherVersions");
const { getCustomerVouchers } = require("./getCustomerVouchers");
const { getCustomerSingleVoucher } = require("./getCustomerSingleVoucher");
const { previewCustomerVoucher } = require("./previewCustomerVoucher");

module.exports = {
  createVoucher,
  updateVoucher,
  submitVoucherForReview,
  reviewVoucher,
  publishVoucher,
  getAllVoucherVersions,
  getCustomerVouchers,
  getCustomerSingleVoucher,
  previewCustomerVoucher,
};
