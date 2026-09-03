const { throwError } = require("../../utils");
const User = require("../../models/User");
const { sendOtpToMobile } = require("../../helpers/twoFactor");
const { ROLES } = require("../../constants");

exports.loginWithMobileOTP = async (body) => {
  let { mobile, role } = body;
  role = role?.toUpperCase() || ROLES.ADMIN;
  const user = await User.findOne({ mobile, role, isDeleted: false }).select(
    "+password",
  );
  if (!user) throwError(404, "User not found with this Mobile");
  return await sendOtpToMobile(mobile);
};
