const { OTP_MAX_VERIFY_ATTEMPTS } = require("../../configs/tendigitOtp");
const { hashOtp } = require("../../utils");
const {
  getOtp,
  deleteOtp,
  incrementAttempts,
} = require("../../db/otpRepository");

exports.verifyOtp = async (phone, code, purpose = "auth") => {
  const record = await getOtp(phone, purpose);
  if (!record) return { ok: false, reason: "expired_or_missing" };
  if (record.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    await deleteOtp(phone, purpose);
    return { ok: false, reason: "max_attempts_exceeded" };
  }
  await incrementAttempts(phone, purpose);
  const providedHash = hashOtp(code, phone, purpose);
  if (providedHash === record.hash) {
    await deleteOtp(phone, purpose);
    return { ok: true };
  }
  return { ok: false, reason: "invalid_code" };
};
