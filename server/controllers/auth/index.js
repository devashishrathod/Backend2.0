const { register } = require("./register");
const { login } = require("./login");
const { loginOrSignUp } = require("./loginOrSignUp");
const { verifyOtp } = require("./verifyOtp");
const { loginWithEmail } = require("./loginWithEmail");
const { verifyOtpWithEmail } = require("./verifyOtpWithEmail");
const { loginWithMobile } = require("./loginWithMobile");
const { verifyOtpWithMobile } = require("./verifyOtpWithMobile");
const { logout } = require("./logout");
const { setPasswordHandler } = require("./setPassword");
const { forgotPasswordHandler } = require("./forgotPassword");
const { resetPasswordHandler } = require("./resetPassword");
const {
  sendEmailVerificationHandler,
  verifyEmailHandler,
} = require("./emailVerification");

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
  setPasswordHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
  sendEmailVerificationHandler,
  verifyEmailHandler,
};
