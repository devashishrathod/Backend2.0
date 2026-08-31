const { asyncWrapper, sendSuccess } = require("../../utils");
const { verifyVoucherClaimPayment } = require("../../services/voucherClaims");

exports.verifyPayment = asyncWrapper(async (req, res) => {
  const result = await verifyVoucherClaimPayment(req, req.validatedData);

  return sendSuccess(
    res,
    200,
    // The webhook may have settled it first. That is a success, not a race the
    // customer needs to hear about.
    result.alreadyVerified
      ? "This payment was already confirmed."
      : "Payment confirmed successfully.",
    result,
  );
});
