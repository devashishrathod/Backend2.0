const { randomInt } = require("crypto");
const User = require("../../models/User");
const { throwError } = require("../../utils");

/**
 * The code somebody shares to get credit for a signup.
 *
 * ### ⚠️ Why `Math.random()` was the wrong tool here
 *
 * `CLAUDE.md` bans it for "anything a stranger benefits from guessing", and a
 * referral code is exactly that: guess a live one and the referral — and
 * whatever it is worth — is attributed to you.
 *
 * The reason is not that `Math.random()` looks insufficiently random. It is that
 * V8's generator is **not seeded from any entropy an attacker cannot reach**,
 * and its internal state is recoverable from a run of outputs. Codes are handed
 * out on request, so collecting that run costs nothing: sign up a few times,
 * read your own codes, and predict the next ones. The same reasoning already
 * moved the OTP generator and the claim code to `crypto`; this was the one left
 * behind.
 *
 * `randomInt` is rejection-sampled, so every character is uniform. Picking with
 * `% alphabet.length` instead would quietly favour the first few letters,
 * because 256 does not divide 62.
 */
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Six characters of a 62-symbol alphabet is about 56 billion codes, so a
 * collision is not the concern the way it is for the 6-digit display ids — the
 * `findOne` below is close to free and stays as a belt-and-braces check.
 *
 * ⚠️ Capped, unlike the `while (true)` it replaces. An uncapped loop on a full
 * space does not fail, it **hangs** — holding a connection from a pool of twenty
 * with no error and no log, until something upstream gives up. Ten collisions in
 * a row here would mean something is badly wrong, and saying so is more useful
 * than spinning.
 */
exports.generateReferralCode = async (length = 6, maxAttempts = 10) => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let referralCode = "";
    for (let i = 0; i < length; i += 1) {
      referralCode += ALPHABET.charAt(randomInt(0, ALPHABET.length));
    }

    const existing = await User.findOne({ referralCode }).select("_id").lean();
    if (!existing) return referralCode;
  }

  throwError(
    500,
    `Could not allocate a referral code after ${maxAttempts} attempts.`,
  );
  return null;
};
