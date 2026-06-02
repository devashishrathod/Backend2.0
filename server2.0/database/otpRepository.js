const Otp = require("../models/OTP");

async function saveOtp(type, target, purpose, hash) {
  await Otp.findOneAndUpdate(
    { type, target, purpose },
    { hash, attempts: 0, createdAt: new Date() },
    { upsert: true, new: true },
  );
}

async function getOtp(target, purpose) {
  return await Otp.findOne({ target, purpose });
}

async function deleteOtp(target, purpose) {
  await Otp.deleteOne({ target, purpose });
}

async function incrementAttempts(target, purpose) {
  const updated = await Otp.findOneAndUpdate(
    { target, purpose },
    { $inc: { attempts: 1 } },
    { new: true },
  );
  return updated ? updated.attempts : null;
}

module.exports = { saveOtp, getOtp, deleteOtp, incrementAttempts };
