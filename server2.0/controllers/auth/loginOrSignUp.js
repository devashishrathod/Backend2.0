const { asyncWrapper, sendSuccess } = require("../../utils");
const { loginOrSignUpWithWhatsapp } = require("../../services/auth");

exports.loginOrSignUp = asyncWrapper(async (req, res) => {
  const result = await loginOrSignUpWithWhatsapp(req.validatedData);
  return sendSuccess(
    res,
    200,
    "OTP sent to your whatsapp number successfully.",
    result,
  );
});
