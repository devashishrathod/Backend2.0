const { asyncWrapper, sendSuccess } = require("../../utils");
const { verifySubscribeTransaction } = require("../../services/transactions");

exports.subscribeVerifyTransaction = asyncWrapper(async (req, res) => {
  const result = await verifySubscribeTransaction(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
  );
  // A replayed verification is a success, not a new activation — say so rather
  // than congratulating the vendor twice for one payment.
  const message = result.alreadyVerified
    ? "This payment has already been verified. Your subscription is active."
    : "Payment successful! Congratulations — your subscription has been successfully activated";
  return sendSuccess(res, 200, message, result);
});
