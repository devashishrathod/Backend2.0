const { raiseRefund } = require("./raise");
const { approveRefund, rejectRefund, withdrawRefund } = require("./decide");
const {
  adminApproveRefund,
  adminRejectRefund,
  payRefund,
} = require("./execute");
const { listRefunds, refundDetail } = require("./listing");
const {
  requestRefundBankDetails,
  chooseRefundBankAccount,
  payRefundToBankAccount,
  confirmRefundBankPayout,
  failRefundBankPayout,
} = require("./manualBank");

module.exports = {
  raiseRefund,
  approveRefund,
  rejectRefund,
  withdrawRefund,
  adminApproveRefund,
  adminRejectRefund,
  payRefund,
  listRefunds,
  refundDetail,
  // MANUAL_BANK — the fallback when the original method cannot take the money.
  requestRefundBankDetails,
  chooseRefundBankAccount,
  payRefundToBankAccount,
  confirmRefundBankPayout,
  failRefundBankPayout,
};
