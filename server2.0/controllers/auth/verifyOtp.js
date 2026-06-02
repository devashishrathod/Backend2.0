const { asyncWrapper, sendSuccess } = require("../../utils");
const { verifyOtpWithWhatsapp } = require("../../services/auth");

exports.verifyOtp = asyncWrapper(async (req, res) => {
  const result = await verifyOtpWithWhatsapp(req.validatedData);
  return sendSuccess(res, 200, "OTP verified successfully", result);
});
