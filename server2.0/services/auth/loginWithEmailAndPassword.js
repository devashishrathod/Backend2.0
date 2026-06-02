const User = require("../../models/User");
const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");

exports.loginWithEmailAndPassword = async (payload) => {
  let { email, password, role } = payload;
  email = email.toLowerCase();
  role = role?.toUpperCase() || ROLES.ADMIN;
  const user = await User.findOne({ email, role });
  if (!user) throwError(404, "Invalid credentials! User not found");
  const matchedPass = await user.matchPassword(password);
  if (!matchedPass) throwError(401, "Invalid credentials! Password mismatch");
  const token = user.getSignedJwtToken();
  return { user, token };
};
