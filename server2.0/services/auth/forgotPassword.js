const User = require("../../models/User");
const { LOGIN_TYPES, ROLES } = require("../../constants");
const { throwError } = require("../../utils");
const { sendOtp } = require("../otps");

// Kept distinct from the "auth" purpose so a login OTP cannot be replayed to
// reset a password, and vice versa.
const PURPOSE = "password-reset";

/**
 * Resolve which account a reset request refers to.
 *
 * `role` is part of the lookup because the same phone number can legitimately
 * exist as both a CUSTOMER and a VENDOR — the rest of the auth layer keys on
 * (identifier, role) the same way.
 */
const findTarget = async ({ type, target, role }) => {
  const resolvedRole = role?.toUpperCase() || ROLES.CUSTOMER;
  const query = { role: resolvedRole, isDeleted: false };

  if (type === LOGIN_TYPES.WHATSAPP) query.whatsappNumber = target.toLowerCase();
  else if (type === LOGIN_TYPES.EMAIL) query.email = target.toLowerCase();
  else if (type === LOGIN_TYPES.MOBILE) query.mobile = target;
  else throwError(422, "Unsupported reset type.");

  return User.findOne(query).select("_id isActive");
};

/**
 * Step 1 of a password reset — send a one-time code.
 *
 * Deliberately returns the **same** response whether or not the account exists.
 * Saying "no such user" here would turn this endpoint into a way to enumerate
 * which phone numbers and emails are registered.
 */
exports.forgotPassword = async (payload) => {
  const { type, target } = payload;

  const user = await findTarget(payload);

  if (user && user.isActive) {
    await sendOtp(type, target, PURPOSE);
  }

  return {
    // Intentionally uniform.
    message:
      "If an account exists for this contact, a verification code has been sent.",
    type,
  };
};

exports.PASSWORD_RESET_PURPOSE = PURPOSE;
exports.findResetTarget = findTarget;
