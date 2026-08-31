const crypto = require("crypto");
const VoucherClaim = require("../../models/VoucherClaim");
const { CLAIM_CODE } = require("../../constants/voucherClaim");
const { throwError } = require("../../utils");

/**
 * A claim code a person can read aloud across a counter.
 *
 * `TD-8F3K2Q`. Random rather than sequential, deliberately: a sequential code
 * would let anyone holding one work out roughly how many claims the platform has
 * taken, and in Phase 2 it becomes the redeem key — a guessable redeem key is a
 * free meal.
 *
 * The alphabet drops every character that is misread when spoken or copied from
 * a screen: `0/O`, `1/I/L`, `5/S`, `2/Z`, `8/B`. Twenty-five characters over six
 * places is about 244 million codes, so a collision is rare — but rare is not
 * never, and the unique index is the actual guarantee. This retries on the
 * duplicate-key error rather than trusting the odds.
 *
 * `crypto.randomInt` and not `Math.random`: this is a redeem key in Phase 2, and
 * a predictable PRNG is exactly how someone else's discount gets spent.
 */
const randomCode = () => {
  const { ALPHABET, LENGTH, PREFIX } = CLAIM_CODE;
  let body = "";
  for (let i = 0; i < LENGTH; i++) {
    body += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return `${PREFIX}-${body}`;
};

/**
 * Generate a code that is not already in use.
 *
 * The read is an optimisation, not the guarantee: two callers can both find it
 * free and both try to write it. The unique partial index settles that, and the
 * caller is expected to retry on an 11000 — which is what `createClaim` does.
 */
exports.generateClaimCode = async () => {
  for (let attempt = 1; attempt <= CLAIM_CODE.MAX_ATTEMPTS; attempt++) {
    const claimCode = randomCode();
    const taken = await VoucherClaim.exists({ claimCode });
    if (!taken) return claimCode;
  }

  // Five collisions in a row against a 244-million space is not bad luck, it is
  // a broken random source or an alphabet mistake. Failing loudly beats issuing
  // a duplicate.
  throwError(
    500,
    "Could not generate a unique claim code. Please try again.",
  );
};

exports.randomClaimCode = randomCode;
