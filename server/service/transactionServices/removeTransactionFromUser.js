const Transaction = require("../../model/Transaction");
const { throwError } = require("../../utils");

exports.removeTransactionFromUser = async (transactionId) => {
  const transaction = await Transaction.findOne({
    _id: transactionId,
    isDeleted: false,
    isRemoved: false,
  }).lean();
  if (!transaction) throwError(404, "transaction not found!");
  const removedTransaction = await Transaction.updateOne(
    { _id: transactionId },
    { isRemoved: true }
  );
  if (removedTransaction.modifiedCount == 1) return true;
  else throwError(400, "Failed transction removed");
};
