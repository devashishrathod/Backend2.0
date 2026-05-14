const { createVoucher } = require("./createVoucher");
const { getAllVouchers } = require("./getAllVouchers");
const { getVoucher } = require("./getVoucher");
const { updateVoucher } = require("./updateVoucher");
const { likeOrDislikeVoucher } = require("./likeOrDislikeVoucher");

module.exports = {
  createVoucher,
  getAllVouchers,
  getVoucher,
  updateVoucher,
  likeOrDislikeVoucher,
};
