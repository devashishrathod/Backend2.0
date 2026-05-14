const Otp = require("../model/OTP");

async function saveOtp(phone, purpose, hash) {
  await Otp.findOneAndUpdate(
    { phone, purpose },
    { hash, attempts: 0, createdAt: new Date() },
    { upsert: true, new: true }
  );
}

async function getOtp(phone, purpose) {
  return await Otp.findOne({ phone, purpose });
}

async function deleteOtp(phone, purpose) {
  await Otp.deleteOne({ phone, purpose });
}

async function incrementAttempts(phone, purpose) {
  const updated = await Otp.findOneAndUpdate(
    { phone, purpose },
    { $inc: { attempts: 1 } },
    { new: true }
  );
  return updated ? updated.attempts : null;
}

module.exports = { saveOtp, getOtp, deleteOtp, incrementAttempts };
