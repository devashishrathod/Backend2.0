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
 * ### Why a list of entries rather than a counter
 *
 * A counter needs a window start, and a fixed window lets twice the limit
 * through at the boundary — five at 10:59, five more at 11:01. Keeping the
 * actual send times makes the window roll: old entries are pruned on every
 * write, so "five in the last hour" means the last hour, always.
 *
 * The list is bounded by the limit itself, so it stays a handful of entries.
 *
 * ### 🔴 Why each entry carries a nonce and not just a time (O-1)
 *
 * This was `sends: [Date]`, and a caller found out whether it had won by asking
 * *"is my timestamp in the array?"*. A timestamp is not an identity. N callers
 * landing in the **same millisecond** compute the same `Date`, so the one write
 * that actually appended was read by **all** of them as their own — every one
 * returned `allowed: true` having written nothing, and N messages went out.
 *
 * The throttle failed precisely under a burst, which is the only case it exists
 * for, and silently. `releaseOtpSend` had the same flaw in reverse: it gave a
 * slot back with `$pull` **by value**, so a failed send could pull the entry
 * somebody else had claimed in that same millisecond.
 *
 * So an entry is now `{ at, nonce }`. The time still drives the window and the
 * cooldown; the nonce answers "was this **my** claim", which is the only
 * question the caller ever needed to ask.
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
    /**
     * Claims inside the current window, oldest first.
     *
     * `_id: false` because these are values, not records — nothing ever refers
     * to one, and `nonce` already tells two entries apart.
     */
    sends: {
      type: [
        new mongoose.Schema(
          {
            at: { type: Date, required: true },
            /** Unique per call. See the note above — this is the identity. */
            nonce: { type: String, required: true },
          },
          { _id: false, versionKey: false },
        ),
      ],
      default: [],
    },
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
