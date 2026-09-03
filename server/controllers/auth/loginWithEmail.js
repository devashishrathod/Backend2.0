const { asyncWrapper, sendSuccess } = require("../../utils");
const { loginWithEmailOTP } = require("../../services/auth");

exports.loginWithEmail = asyncWrapper(async (req, res) => {
  await loginWithEmailOTP(req.validatedData);
  return sendSuccess(
    res,
    200,
    "OTP has been sent to your Email. Please check your inbox.",
  );
});
