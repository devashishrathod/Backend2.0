const User = require("../../model/User");

exports.getUserByWhatsapp = async (whatsappNumber) => {
  return await User.findOne({ whatsappNumber });
};
