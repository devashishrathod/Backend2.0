const User = require("../../models/User");
const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");
const { assertAccountAccess, markSignedIn } = require("../../helpers/auth");
const { sanitizeUser } = require("../../helpers/users");

exports.loginWithEmailAndPassword = async (payload) => {
  let { email, password, role } = payload;
  email = email.toLowerCase();
  role = role?.toUpperCase() || ROLES.ADMIN;
  // `isDeleted` was missing here, so a soft-deleted account could still sign in.
  // Filtering it in the query rather than checking after means a deleted account
  // is indistinguishable from one that never existed.
  const user = await User.findOne({ email, role, isDeleted: false });
  if (!user) throwError(404, "Invalid credentials! User not found");
  // Minting a token for a deactivated account was the last way around the auth
  // gate: every request would then be refused, but the token should never have
  // been issued. Checked before the password so a suspended account cannot be
  // probed for a valid password either.
  assertAccountAccess(user);
  // Fail closed on an account that never chose a password. Without this an
  // OTP-only account would be reachable by whatever default it was seeded with.
  if (!user.hasPassword()) {
    throwError(
      401,
      "This account uses OTP login. Set a password from your profile before signing in this way.",
    );
  }
  const matchedPass = await user.matchPassword(password);
  if (!matchedPass) throwError(401, "Invalid credentials! Password mismatch");
  const token = user.getSignedJwtToken();
  // The admin directory filters on these, and this path never set them.
  await markSignedIn(user._id);
  /**
   * ⚠️ Sanitized because this path loads the document **with** its password —
   * it has to, in order to compare one. Returning `user` raw therefore handed
   * the bcrypt hash back on every successful admin login, where it landed in
   * client logs, crash reports and analytics payloads.
   *
   * The OTP paths projected `-password` at the query and so only leaked `__v`;
   * this one could not, which is exactly why it needed the helper rather than a
   * projection.
   */
  return { user: sanitizeUser(user), token };
};
