const { addBankAccount } = require("./addBankAccount");
const { updateBankAccountById } = require("./updateBankAccountById");
const { getBankByUserId } = require("./getBankByUserId");
const { getBankByAccountNumber } = require("./getBankByAccountNumber");

module.exports = {
  addBankAccount,
  updateBankAccountById,
  getBankByUserId,
  getBankByAccountNumber,
};
