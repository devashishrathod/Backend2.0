const {
  listSettlements,
  settlementDetail,
  settlementTransactions,
} = require("./listing");
const {
  approve,
  rebuild,
  hold,
  cancel,
  abandon,
  pay,
  confirm,
  fail,
  retry,
  reverse,
} = require("./admin");
const { vendorDebt, vendorDebtWriteOff } = require("./vendorDebt");

module.exports = {
  listSettlements,
  settlementDetail,
  settlementTransactions,
  approve,
  rebuild,
  hold,
  cancel,
  abandon,
  pay,
  confirm,
  fail,
  retry,
  reverse,
  // Public, token-addressed, no JWT — see the controller.
  /**
   * ⚠️ Debt a settlement cycle can never reach — every cycle claims it, nets
   * negative, carries forward and releases it again.
   */
  vendorDebt,
  vendorDebtWriteOff,
};
