const { generateNumericOtp, hashOtp } = require("../../utils");
const { saveOtp } = require("../../db/otpRepository");
const { sendTemplate } = require("../../helpers/otpHelper");

exports.sendOtp = async (phone, purpose = "auth") => {
  const otp = generateNumericOtp();
  const hash = hashOtp(otp, phone, purpose);
  await saveOtp(phone, purpose, hash);
  await sendTemplate({ phone, params: otp, urlParam: otp });
  return { success: true, message: "OTP sent" };
};
