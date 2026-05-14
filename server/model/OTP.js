const mongoose = require("mongoose");
const { OTP_TTL_SECONDS } = require("../configs/tendigitOtp");

const otpSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true },
    purpose: { type: String, default: "auth" },
    hash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, expires: OTP_TTL_SECONDS },
  },
  { versionKey: false }
);

otpSchema.index({ phone: 1, purpose: 1 }, { unique: true });

module.exports = mongoose.model("Otp", otpSchema);
