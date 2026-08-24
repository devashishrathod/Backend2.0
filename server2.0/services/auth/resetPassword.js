const User = require("../../models/User");
const { throwError } = require("../../utils");
const { verifyOtp } = require("../otps");
const {
  PASSWORD_RESET_PURPOSE,
  findResetTarget,
} = require("./forgotPassword");

/**
 * Step 2 of a password reset — verify the code and set the new password.
 *
 * The OTP is checked under the `password-reset` purpose, so a login code cannot
 * be replayed here. `verifyOtp` consumes the code on success, which makes this
 * single-use, and it enforces its own attempt cap.
 *
 * Unlike `forgotPassword`, this does report a missing account: by the time a
 * valid one-time code has been presented, there is nothing left to enumerate.
 */
exports.resetPassword = async (payload) => {
  const { target, otp, newPassword } = payload;

  await verifyOtp(target, otp, PASSWORD_RESET_PURPOSE);

  const found = await findResetTarget(payload);
  if (!found) throwError(404, "No account found for this contact.");

  const user = await User.findById(found._id);
  if (!user || user.isDeleted) throwError(404, "No account found for this contact.");
  if (!user.isActive) {
    throwError(403, "Your account is deactivated. Please contact support.");
  }

  // Hashed by the pre-save hook on the model.
  user.password = newPassword;
  user.passwordSetAt = new Date();
  await user.save();

  return {
    userId: user._id,
    passwordSetAt: user.passwordSetAt,
    // No token is issued here on purpose: resetting a password should not also
    // hand out a session. The user logs in with the new one.
    message: "Password updated. Please sign in with your new password.",
  };
};
