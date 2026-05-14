const bcrypt = require("bcryptjs");
const User = require("../../model/User");
const { ROLES } = require("../../constants");
const { generateToken } = require("../../middleware");
const { throwError } = require("../../utils");

exports.loginWithEmailAndPassword = async (payload) => {
  let { email, password, role } = payload;
  role = role?.toLowerCase() || ROLES.ADMIN;
  const checkUser = await User.findOne({ email, role });
  if (!checkUser) throwError(404, "Invalid credentials! User not found");
  const matchedPass = bcrypt.compare(password, checkUser.password);
  if (!matchedPass) throwError(404, "Invalid credentials");
  const token = await generateToken(checkUser);
  return { user: checkUser, token };
};
