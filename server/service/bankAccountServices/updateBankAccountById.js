const BankAccount = require("../../model/BankAccount");
const { findByIdAndUpdate } = require("../../db/dbServices");

exports.updateBankAccountById = async (id, updatedData) => {
  return await findByIdAndUpdate(BankAccount, id, updatedData);
};
