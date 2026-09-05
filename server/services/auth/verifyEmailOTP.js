const User = require("../../models/User");
const { throwError } = require("../../utils");
const { verifyOtp } = require("../otps");
const { sendOtpVerificationSuccessMail } = require("../../helpers/nodeMailer");
const { LOGIN_TYPES, ROLES } = require("../../constants");
const { assertAccountAccess } = require("../../helpers/auth");
const { sanitizeUser } = require("../../helpers/users");

exports.verifyEmailOTP = async (body) => {
  let { otp, email, role, currentScreen } = body;
  email = email?.toLowerCase();
  role = role?.toUpperCase() || ROLES.ADMIN;
  let user = await User.findOne({ email, role, isDeleted: false }).select(
    "-password",
  );
  if (!user) throwError(404, "User not found with this email");
  // An account can be deactivated between requesting a code and presenting it,
  // and this is a token-issuing path — so the check belongs here too, not only
  // on the step that sent the OTP.
  assertAccountAccess(user);
  const result = await verifyOtp(email, otp);
  if (result.ok) {
    user.loginType = LOGIN_TYPES.EMAIL;
    user.isEmailVerified = true;
    user.isLoggedIn = true;
    user.isOnline = true;
    if (currentScreen) user.currentScreen = currentScreen.toUpperCase().trim();
    user = await user.save();
    const token = user.getSignedJwtToken();
    await sendOtpVerificationSuccessMail(email);
    /**
     * The `-password` projection above already keeps the hash out. This adds the
     * rest of what `sanitizeUser` guards — `__v` and `meta` (the device's push
     * token and IP) — so every token-issuing path answers with the same shape
     * rather than each one remembering its own subset.
     */
    return { user: sanitizeUser(user), token };
  }
  throwError(400, "Invalid OTP");
};
