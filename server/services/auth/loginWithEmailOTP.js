const User = require("../../models/User");
const { throwError } = require("../../utils");
const { sendOtp } = require("../otps/sendOtp");
const { LOGIN_TYPES, ROLES } = require("../../constants");

exports.loginWithEmailOTP = async (body) => {
  let { email, role } = body;
  email = email?.toLowerCase();
  role = role?.toUpperCase() || ROLES.ADMIN;
  let user = await User.findOne({ email, role, isDeleted: false }).select(
    "+password",
  );
  if (!user) throwError(404, "User not found with this email");
  await sendOtp(LOGIN_TYPES.EMAIL, email);
};
