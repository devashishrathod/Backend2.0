const User = require("../../model/User");
const { ROLES } = require("../../constants");
const { generateToken } = require("../../middleware");
const { verifyOtp } = require("../otpServices");
const { throwError } = require("../../utils");

exports.verifyOtpWithWhatsapp = async ({
  otp,
  whatsappNumber,
  role,
  fcmToken,
  currentScreen,
}) => {
  role = role || ROLES.USER;
  whatsappNumber = whatsappNumber?.toLowerCase();
  const user = await User.findOne({ whatsappNumber, role, isDeleted: false });
  if (!user) throwError(404, "User not found!");
  const result = await verifyOtp(whatsappNumber, otp);
  if (!result?.ok) throwError(400, result?.reason);
  user.isMobileVerified = true;
  if (fcmToken) user.fcmToken = fcmToken;
  if (currentScreen) user.currentScreen = currentScreen.toUpperCase();
  await user.save();
  if (
    role === ROLES.VENDOR &&
    currentScreen?.toUpperCase() === "CATEGORY_SELECTION" &&
    !user.isSignUpCompleted
  ) {
    await User.updateOne(
      { whatsappNumber, role: ROLES.SUB_VENDOR, isDeleted: false },
      { $set: { isMobileVerified: true } },
    );
  }
  const token = await generateToken(user);
  return {
    data: {
      result,
      user,
      token,
    },
  };
};
