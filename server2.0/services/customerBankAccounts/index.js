const { sendBankOtp } = require("./sendBankOtp");
const { addBankAccount, present } = require("./addBankAccount");
const { getBankAccounts, removeBankAccount } = require("./getBankAccounts");

module.exports = {
  sendBankOtp,
  addBankAccount,
  getBankAccounts,
  removeBankAccount,
  // Shared with the refund read pipeline so a payee is masked the same way
  // wherever it is shown.
  present,
};
