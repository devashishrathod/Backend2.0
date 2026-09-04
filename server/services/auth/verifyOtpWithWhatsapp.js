const User = require("../../models/User");
const { ROLES } = require("../../constants");
const { verifyOtp } = require("../../services/otps");
const { throwError } = require("../../utils");
const { assertAccountAccess } = require("../../helpers/auth");
const { sanitizeUser } = require("../../helpers/users");

exports.verifyOtpWithWhatsapp = async (body) => {
  let { otp, whatsappNumber, role, currentScreen } = body;
  role = role?.toUpperCase() || ROLES.CUSTOMER;
  whatsappNumber = whatsappNumber?.toLowerCase();

  const user = await User.findOne({ whatsappNumber, role, isDeleted: false });
  if (!user) throwError(404, "Invalid Whatsapp number, user not found!");

  // Step one refuses to *create* a deactivated account's role, but an account
  // can be deactivated between requesting a code and presenting it. Same shared
  // gate as the middlewares, so the refusal carries `details.code` and the
  // client branches on one value everywhere.
  assertAccountAccess(user);

  //  await verifyOtp(whatsappNumber, otp);

  user.isMobileVerified = true;
  if (currentScreen) user.currentScreen = currentScreen.toUpperCase().trim();
  // Set on the document rather than through `markSignedIn`, because this
  // path already saves — a second write for two booleans is waste. Same two
  // fields, same meaning; see helpers/auth/markSession.js for why they
  // matter and why they were missing here.
  user.isLoggedIn = true;
  user.isOnline = true;
  await user.save();

  const token = user.getSignedJwtToken();

  return { user: sanitizeUser(user), token };
};
