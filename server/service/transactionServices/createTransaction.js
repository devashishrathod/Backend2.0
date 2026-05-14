const Transaction = require("../../model/Transaction");
const { createItem } = require("../../db/dbServices");

exports.createTransaction = async (payload) => {
  return await createItem(Transaction, payload);
};
