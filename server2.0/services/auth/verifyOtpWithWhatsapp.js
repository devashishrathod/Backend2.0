const User = require("../../models/User");
const { ROLES } = require("../../constants");
const { verifyOtp } = require("../../services/otps");
const { throwError } = require("../../utils");

exports.verifyOtpWithWhatsapp = async (body) => {
  let { otp, whatsappNumber, role, currentScreen } = body;
  role = role?.toUpperCase() || ROLES.CUSTOMER;
  whatsappNumber = whatsappNumber?.toLowerCase();
  const user = await User.findOne({ whatsappNumber, role, isDeleted: false });
  if (!user) throwError(404, "Invalid Whatsapp number, user not found!");
  //  await verifyOtp(whatsappNumber, otp);
  user.isMobileVerified = true;
  if (currentScreen) user.currentScreen = currentScreen.toUpperCase().trim();
  await user.save();
  const token = user.getSignedJwtToken();
  return { user, token };
};
