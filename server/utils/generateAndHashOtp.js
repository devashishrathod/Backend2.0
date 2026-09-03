const crypto = require("node:crypto");
const { OTP_LENGTH, HMAC_SECRET } = require("../configs/tendigitOtp");

/**
 * A one-time code.
 *
 * ### ⚠️ `crypto.randomInt`, never `Math.random()`
 *
 * This used `Math.random()`, and that is not a small thing here. V8's generator
 * is fast and **predictable**: it is not seeded from any entropy source a caller
 * cannot reach, and its internal state can be recovered from a modest run of
 * outputs. An attacker gathering those outputs is not hypothetical — they can
 * simply request codes to their own number, as many as they like, and each one
 * is a sample.
 *
 * What that buys them depends on what a code unlocks, and here it unlocks
 * logging in as somebody else and **attaching a bank account a refund is then
 * paid into**. `crypto.randomInt` draws from the OS CSPRNG and is unbiased
 * across the range; the cost is a handful of microseconds, once per code.
 *
 * The hash below was always proper HMAC-SHA256 — the weak link was only ever the
 * number being hashed.
 */
exports.generateNumericOtp = (length = OTP_LENGTH) => {
  let digits = "";
  for (let i = 0; i < length; i++) {
    // Per digit rather than one draw over 10**length: correct for any length,
    // with no chance of drifting past a safe integer.
    digits += crypto.randomInt(0, 10);
  }
  return digits;
};

exports.hashOtp = (otp, target, purpose) => {
  return crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(`${target}|${purpose}|${otp}`)
    .digest("hex");
};
