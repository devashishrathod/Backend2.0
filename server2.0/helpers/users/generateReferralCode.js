const User = require("../../models/User");

exports.generateReferralCode = async (length = 6) => {
  while (true) {
    const characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let referralCode = "";
    for (let i = 0; i < length; i++) {
      referralCode += characters.charAt(
        Math.floor(Math.random() * characters.length),
      );
    }
    const existingUser = await User.findOne({ referralCode });
    if (!existingUser) return referralCode;
  }
};
