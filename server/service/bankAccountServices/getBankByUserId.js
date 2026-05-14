const BankAccount = require("../../model/BankAccount");
const { findOne } = require("../../db/dbServices");

exports.getBankByUserId = async (userId) => {
  return await findOne(BankAccount, { user: userId, isDeleted: false });
};
