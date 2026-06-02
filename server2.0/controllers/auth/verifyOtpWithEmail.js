const { asyncWrapper, sendSuccess } = require("../../utils");
const { verifyEmailOTP } = require("../../services/auth");

exports.verifyOtpWithEmail = asyncWrapper(async (req, res) => {
  const result = await verifyEmailOTP(req.validatedData);
  return sendSuccess(res, 200, "OTP Verification successful", result);
});
