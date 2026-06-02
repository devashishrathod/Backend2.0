const { asyncWrapper, sendSuccess } = require("../../utils");
const { loginWithMobileOTP } = require("../../services/auth");

exports.loginWithMobile = asyncWrapper(async (req, res) => {
  const result = await loginWithMobileOTP(req.validatedData);
  return sendSuccess(
    res,
    200,
    "OTP has been sent to your Mobile. Please check your inbox.",
    result,
  );
});
