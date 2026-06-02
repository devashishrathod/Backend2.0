const { saveOtp } = require("../../database/otpRepository");
const { sendTemplate } = require("../../helpers/otps");
const { sendLoginOtpMail } = require("../../helpers/nodeMailer");
const { LOGIN_TYPES } = require("../../constants");
const { generateNumericOtp, hashOtp, throwError } = require("../../utils");

exports.sendOtp = async (type, target, purpose = "auth") => {
  const otp = generateNumericOtp();
  const hash = hashOtp(otp, target, purpose);
  await saveOtp(type, target, purpose, hash);
  if (type === LOGIN_TYPES.WHATSAPP) {
    await sendTemplate(target, otp, otp);
  } else if (type === LOGIN_TYPES.EMAIL) {
    await sendLoginOtpMail(target, otp);
  } else throwError(401, "Invalid login type");
  return { success: true, message: "OTP sent" };
};
