const { assertAccountAccess } = require("./assertAccountAccess");
const { assertIdentityVerified } = require("./assertIdentityVerified");
const { markSignedIn, markSignedOut } = require("./markSession");

module.exports = {
  assertAccountAccess,
  /**
   * An unverified `email` or `mobile` is a stored value, not a sign-in identity.
   * Both OTP login paths check it, so a key written by somebody other than the
   * account holder cannot be used to get in.
   */
  assertIdentityVerified,
  /**
   * Every path that mints a token calls `markSignedIn`; logout calls
   * `markSignedOut`. One definition, because four of the seven token-issuing
   * paths had silently skipped these flags and nothing said so.
   */
  markSignedIn,
  markSignedOut,
};
