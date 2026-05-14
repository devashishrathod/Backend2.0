const { asyncWrapper, sendSuccess } = require("../../utils");
const { verifyOtpWithWhatsapp } = require("../../service/authServices");

exports.verifyOtp = asyncWrapper(async (req, res) => {
  const { data } = await verifyOtpWithWhatsapp(req.body);
  return sendSuccess(res, 200, "Verification successful", data);
});
