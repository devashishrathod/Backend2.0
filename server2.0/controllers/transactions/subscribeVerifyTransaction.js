const { asyncWrapper, sendSuccess } = require("../../utils");
const { verifySubscribeTransaction } = require("../../services/transactions");

exports.subscribeVerifyTransaction = asyncWrapper(async (req, res) => {
  const result = await verifySubscribeTransaction(
    req.userId,
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    "Payment successful! Congratulations — your subscription has been successfully activated",
    result,
  );
});
