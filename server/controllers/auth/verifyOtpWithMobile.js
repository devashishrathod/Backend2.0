const { asyncWrapper, sendSuccess } = require("../../utils");
const { verifyMobileOTP } = require("../../services/auth");

exports.verifyOtpWithMobile = asyncWrapper(async (req, res) => {
  const result = await verifyMobileOTP(req.validatedData);
  return sendSuccess(res, 200, "OTP Verification successful", result);
});
