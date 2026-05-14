const Transaction = require("../../model/Transaction");
const { findOneAndUpdate } = require("../../db/dbServices");

exports.updateTransactionByOrderAndUserId = async (filter, updatedData) => {
  const filtered = { isDeleted: false, ...filter };
  return await findOneAndUpdate(Transaction, filtered, updatedData);
};
