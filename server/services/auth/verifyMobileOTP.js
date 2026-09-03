const User = require("../../models/User");
const { LOGIN_TYPES, ROLES } = require("../../constants");
const { throwError } = require("../../utils");
const { assertAccountAccess } = require("../../helpers/auth");
const { verifyOtpToMobile } = require("../../helpers/twoFactor");

exports.verifyMobileOTP = async (body) => {
  let { sessionId, otp, mobile, role, currentScreen } = body;
  role = role?.toUpperCase() || ROLES.ADMIN;
  let user = await User.findOne({ mobile, role, isDeleted: false }).select(
    "-password",
  );
  if (!user) throwError(404, "User not found with this mobile number");
  // See verifyEmailOTP — this issues a token, so it needs the gate too.
  assertAccountAccess(user);
  let result = await verifyOtpToMobile(sessionId, otp);
  if (result?.Status == "Success") {
    user.loginType = LOGIN_TYPES.MOBILE;
    user.isMobileVerified = true;
    user.isLoggedIn = true;
    user.isOnline = true;
    if (currentScreen) user.currentScreen = currentScreen.toUpperCase().trim();
    user = await user.save();
    const token = user.getSignedJwtToken();
    return { user, token };
  } else throwError(401, "Invalid OTP");
};
