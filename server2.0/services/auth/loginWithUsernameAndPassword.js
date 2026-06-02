const User = require("../../models/User");
const { throwError } = require("../../utils");

exports.loginWithUsernameAndPassword = async (payload) => {
  let { username, password } = payload;
  username = username.toLowerCase();
  const user = await User.findOne({ username });
  if (!user) throwError(404, "Invalid credentials! User not found");
  const matchedPass = await user.matchPassword(password);
  if (!matchedPass) throwError(401, "Invalid credentials! Password mismatch");
  const token = user.getSignedJwtToken();
  return { user, token };
};
