const { generateReferralCode } = require("./generateReferralCode");
const { generateUniqueUserId } = require("./generateUniqueUserId");
const { sanitizeUser } = require("./sanitizeUser");
const { maskEmail, maskPhone } = require("./maskContact");

module.exports = {
  generateReferralCode,
  generateUniqueUserId,
  sanitizeUser,
  maskEmail,
  maskPhone,
};
