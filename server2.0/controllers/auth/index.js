const { register } = require("./register");
const { login } = require("./login");
const { loginOrSignUp } = require("./loginOrSignUp");
const { verifyOtp } = require("./verifyOtp");
const { loginWithEmail } = require("./loginWithEmail");
const { verifyOtpWithEmail } = require("./verifyOtpWithEmail");
const { loginWithMobile } = require("./loginWithMobile");
const { verifyOtpWithMobile } = require("./verifyOtpWithMobile");
const { logout } = require("./logout");

module.exports = {
  register,
  login,
  loginOrSignUp,
  verifyOtp,
  loginWithEmail,
  verifyOtpWithEmail,
  loginWithMobile,
  verifyOtpWithMobile,
  logout,
};
