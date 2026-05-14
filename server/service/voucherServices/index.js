const { addVoucher } = require("./addVoucher");
const { getVouchers } = require("./getVouchers");
const { getVoucherById } = require("./getVoucherById");
const { updateVoucherById } = require("./updateVoucherById");
const { toggleVoucherLike } = require("./toggleVoucherLike");

module.exports = {
  addVoucher,
  getVouchers,
  getVoucherById,
  updateVoucherById,
  toggleVoucherLike,
};
