const { sendLoginOtpMail } = require("./sendLoginOtpMail");
const {
  sendOtpVerificationSuccessMail,
} = require("./sendOtpVerificationSuccessMail");
const { sendMail } = require("./sendMail");

module.exports = { sendLoginOtpMail, sendOtpVerificationSuccessMail, sendMail };
