const BankAccount = require("../../model/BankAccount");
const { createItem } = require("../../db/dbServices");

exports.addBankAccount = async (payload) => {
  return await createItem(BankAccount, payload);
};
