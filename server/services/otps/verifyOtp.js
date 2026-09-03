const { OTP_MAX_VERIFY_ATTEMPTS } = require("../../configs/tendigitOtp");
const { hashOtp, throwError } = require("../../utils");
const {
  getOtp,
  deleteOtp,
  incrementAttempts,
} = require("../../database/otpRepository");

exports.verifyOtp = async (target, code, purpose = "auth") => {
  const record = await getOtp(target, purpose);
  if (!record) throwError(401, "Please resend OTP! OTP is expired or missing");
  if (record.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    await deleteOtp(target, purpose);
    throwError(403, "Max attempts exceeded! Please try again later.");
  }
  await incrementAttempts(target, purpose);
  const providedHash = hashOtp(code, target, purpose);
  if (providedHash === record.hash) {
    await deleteOtp(target, purpose);
    return { ok: true };
  }
  throwError(401, "Invalid OTP! Please try again.");
};
