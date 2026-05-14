const { sendSuccess, asyncWrapper } = require("../../utils");
const {
  removeTransactionFromUser,
} = require("../../service/transactionServices");

exports.removeTransaction = asyncWrapper(async (req, res, next) => {
  const { transactionId } = req?.params;
  const isremoved = await removeTransactionFromUser(transactionId);
  if (isremoved)
    return sendSuccess(res, 200, "Transaction removed successfully");
});
