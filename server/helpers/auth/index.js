const { assertAccountAccess } = require("./assertAccountAccess");
const { markSignedIn, markSignedOut } = require("./markSession");

module.exports = {
  assertAccountAccess,
  /**
   * Every path that mints a token calls `markSignedIn`; logout calls
   * `markSignedOut`. One definition, because four of the seven token-issuing
   * paths had silently skipped these flags and nothing said so.
   */
  markSignedIn,
  markSignedOut,
};
