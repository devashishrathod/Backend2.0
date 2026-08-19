const { create } = require("./create");
// const { update } = require("./update");
const { submitForReview } = require("./submitForReview");
const { review } = require("./review");
const { publish } = require("./publish");
const { getAllVersions } = require("./getAllVersions");
const { getAllCustomerVouchers } = require("./getAllCustomerVouchers");
const { getCustomerVoucher } = require("./getCustomerVoucher");

module.exports = {
  create,
  //update,
  submitForReview,
  review,
  publish,
  getAllVersions,
  getAllCustomerVouchers,
  getCustomerVoucher,
};
