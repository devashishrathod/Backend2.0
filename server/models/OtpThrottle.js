const mongoose = require("mongoose");
const { OTP_THROTTLE_TTL_SECONDS } = require("../constants/otp");

/**
 * When codes were last sent to one target, so `sendOtp` can refuse the next one.
 *
 * ### ⚠️ Why this is not fields on the `Otp` document
 *
 * `Otp` carries a **5-minute TTL** — it has to, because a code must expire. A
 * counter living on it would be deleted four times over inside a one-hour
 * window, so the limit would reset every five minutes and cap nothing. This row
 * outlives the codes it counts.
 *
 * ### Why a list of timestamps rather than a counter
 *
 * A counter needs a window start, and a fixed window lets twice the limit
 * through at the boundary — five at 10:59, five more at 11:01. Keeping the
 * actual send times makes the window roll: old entries are pruned on every
 * write, so "five in the last hour" means the last hour, always.
 *
 * The list is bounded by the limit itself, so it stays a handful of dates.
 */
const otpThrottleSchema = new mongoose.Schema(
  {
    /** The phone number or email a code goes to. */
    target: { type: String, required: true },
    /**
     * Scoped by purpose, so signing in and attaching a bank account do not eat
     * each other's allowance — they are different acts by the same person, and
     * being unable to log in because you added an account is not a limit anyone
     * would understand.
     */
    purpose: { type: String, required: true },
    /** Send times inside the current window, oldest first. */
    sends: { type: [Date], default: [] },
    /**
     * Touched on every attempt, allowed or refused, because it is what the TTL
     * expires on. Dating it only on success would let a target being hammered
     * have its row expire mid-flood and start again from zero.
     */
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

otpThrottleSchema.index(
  { target: 1, purpose: 1 },
  { name: "otp_throttle_target_purpose_unique", unique: true },
);

otpThrottleSchema.index(
  { updatedAt: 1 },
  {
    name: "otp_throttle_ttl",
    expireAfterSeconds: OTP_THROTTLE_TTL_SECONDS,
  },
);

module.exports = mongoose.model("OtpThrottle", otpThrottleSchema);
