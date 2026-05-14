const { asyncWrapper, sendSuccess } = require("../../utils");
const { loginOrSignUpWithWhatsapp } = require("../../service/authServices");

exports.loginOrSignUp = asyncWrapper(async (req, res) => {
  const { data, isFirst } = await loginOrSignUpWithWhatsapp(req.body);
  return sendSuccess(
    res,
    200,
    "OTP sent to your whatsapp number successfully.",
    { isFirst, ...data }
  );
});
