const User = require("../../models/User");
const { throwError } = require("../../utils");
const { assertAccountAccess, markSignedIn } = require("../../helpers/auth");
const { sanitizeUser } = require("../../helpers/users");

exports.loginWithUsernameAndPassword = async (payload) => {
  let { username, password } = payload;
  username = username.toLowerCase();
  // See loginWithEmailAndPassword: `isDeleted` was missing, and a deactivated
  // account could mint a token.
  const user = await User.findOne({ username, isDeleted: false });
  if (!user) throwError(404, "Invalid credentials! User not found");
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
  // See loginWithEmailAndPassword: this document carries the bcrypt hash because
  // the password had to be compared against it.
  return { user: sanitizeUser(user), token };
};
