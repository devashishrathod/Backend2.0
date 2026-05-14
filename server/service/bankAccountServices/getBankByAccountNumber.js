const BankAccount = require("../../model/BankAccount");
const { findOne } = require("../../db/dbServices");

exports.getBankByAccountNumber = async (accountNumber) => {
  return await findOne(BankAccount, {
    accountNumber: accountNumber,
    isDeleted: false,
  });
};
