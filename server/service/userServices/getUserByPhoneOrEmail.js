const User = require("../../model/User");

exports.getUserByPhoneOrEmail = async (email, whatsappNumber) => {
  return await User.findOne({
    $or: [{ email }, { whatsappNumber }],
    isDeleted: { $in: [false, true] },
  }).lean();
};
