const mongoose = require("mongoose");
const { OTP_TTL_SECONDS } = require("../configs/tendigitOtp");
const { LOGIN_TYPES } = require("../constants");

const otpSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [LOGIN_TYPES.EMAIL, LOGIN_TYPES.WHATSAPP],
      required: true,
    },
    target: { type: String, required: true },
    purpose: { type: String, default: "auth" },
    hash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, expires: OTP_TTL_SECONDS },
  },
  { versionKey: false },
);

otpSchema.index({ target: 1, purpose: 1 }, { unique: true });

module.exports = mongoose.model("Otp", otpSchema);
