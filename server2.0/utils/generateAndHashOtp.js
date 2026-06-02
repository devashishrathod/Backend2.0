const crypto = require("node:crypto");
const { OTP_LENGTH, HMAC_SECRET } = require("../configs/tendigitOtp");

exports.generateNumericOtp = (length = OTP_LENGTH) => {
  let digits = "";
  for (let i = 0; i < length; i++) {
    digits += Math.floor(Math.random() * 10);
  }
  return digits;
};

exports.hashOtp = (otp, target, purpose) => {
  return crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(`${target}|${purpose}|${otp}`)
    .digest("hex");
};
