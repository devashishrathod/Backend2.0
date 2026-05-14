const { registerUser } = require("./registerUser");
const { loginOrSignUpWithWhatsapp } = require("./loginOrSignUpWithWhatsapp");
const { verifyOtpWithWhatsapp } = require("./verifyOtpWithWhatsapp");
const { loginWithMobileAndPassword } = require("./loginWithMobileAndPassword");
const { loginWithEmailAndPassword } = require("./loginWithEmailAndPassword");

module.exports = {
  registerUser,
  loginOrSignUpWithWhatsapp,
  verifyOtpWithWhatsapp,
  loginWithMobileAndPassword,
  loginWithEmailAndPassword,
};
