const { registerUser } = require("./registerUser");
const { loginOrSignUpWithWhatsapp } = require("./loginOrSignUpWithWhatsapp");
const { verifyOtpWithWhatsapp } = require("./verifyOtpWithWhatsapp");
const { loginWithMobileAndPassword } = require("./loginWithMobileAndPassword");
const { loginWithEmailAndPassword } = require("./loginWithEmailAndPassword");
const {
  loginWithUsernameAndPassword,
} = require("./loginWithUsernameAndPassword");
const { loginWithMobileOTP } = require("./loginWithMobileOTP");
const { loginWithEmailOTP } = require("./loginWithEmailOTP");
const { verifyEmailOTP } = require("./verifyEmailOTP");
const { verifyMobileOTP } = require("./verifyMobileOTP");
const { setPassword } = require("./setPassword");
const { forgotPassword } = require("./forgotPassword");
const { resetPassword } = require("./resetPassword");

module.exports = {
  registerUser,
  loginOrSignUpWithWhatsapp,
  verifyOtpWithWhatsapp,
  loginWithMobileAndPassword,
  loginWithEmailAndPassword,
  loginWithUsernameAndPassword,
  loginWithMobileOTP,
  loginWithEmailOTP,
  verifyEmailOTP,
  verifyMobileOTP,
  setPassword,
  forgotPassword,
  resetPassword,
};
