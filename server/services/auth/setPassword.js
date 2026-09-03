const User = require("../../models/User");
const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");

/**
 * Let a signed-in user choose or change their own password.
 *
 * This is the flow that was missing entirely. Every OTP-created account used to
 * be seeded with the same shared `DEFAULT_PASSWORD` and there was no way to
 * replace it, so one known string logged into any of them. Accounts now start
 * with **no** password, and password login is only possible once the user has
 * been through here.
 *
 * Two cases, one endpoint:
 *  - **first time** — no password on the account, so none is asked for
 *  - **change** — `currentPassword` is required and must match, otherwise a
 *    stolen session could silently lock the real owner out
 */
exports.setPassword = async (userId, payload) => {
  const { currentPassword, newPassword } = payload;

  const user = await User.findById(userId);
  if (!user || user.isDeleted) throwError(404, "User not found");

  // The route already gates on `isAdmin`; this is the same rule stated where the
  // decision actually lives, so a future caller that reaches the service by some
  // other path cannot hand a customer or vendor a password.
  if (user.role !== ROLES.ADMIN) {
    throwError(
      403,
      "Password sign-in is not available for this account type. Please sign in with a WhatsApp OTP.",
    );
  }

  const alreadyHasOne = user.hasPassword();

  if (alreadyHasOne) {
    if (!currentPassword) {
      throwError(
        422,
        "currentPassword is required to change an existing password.",
      );
    }
    const matched = await user.matchPassword(currentPassword);
    if (!matched) throwError(401, "Current password is incorrect.");

    // Rejected rather than silently accepted, so "password changed" always
    // means something actually changed.
    const sameAsBefore = await user.matchPassword(newPassword);
    if (sameAsBefore) {
      throwError(422, "The new password must be different from the current one.");
    }
  }

  // Hashed by the pre-save hook on the model.
  user.password = newPassword;
  user.passwordSetAt = new Date();
  await user.save();

  return {
    userId: user._id,
    // Tells the client whether to show "password set" or "password changed".
    wasFirstTime: !alreadyHasOne,
    passwordSetAt: user.passwordSetAt,
  };
};
