const { register } = require("./register");
const { login } = require("./login");
const { loginOrSignUp } = require("./loginOrSignUp");
const { verifyOtp } = require("./verifyOtp");

module.exports = { register, login, loginOrSignUp, verifyOtp };
