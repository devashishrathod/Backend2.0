const User = require("../../models/User");
const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");
const { assertAccountAccess } = require("../../helpers/auth");

exports.loginWithMobileAndPassword = async (payload) => {
  let { mobile, password, role } = payload;
  role = role?.toUpperCase() || ROLES.ADMIN;
  // See loginWithEmailAndPassword: `isDeleted` was missing, and a deactivated
  // account could mint a token.
  const user = await User.findOne({ mobile, role, isDeleted: false });
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
  return { user, token };
};
