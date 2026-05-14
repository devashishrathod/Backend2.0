const Transaction = require("../../model/Transaction");
const { findOne } = require("../../db/dbServices");

exports.getTransactionById = async (id) => {
  return await findOne(Transaction, { _id: id, isDeleted: false });
};
