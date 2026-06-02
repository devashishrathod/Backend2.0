const User = require("../../models/User");

exports.generateUniqueUserId = async () => {
  const prefix = "#TD";
  while (true) {
    const randomNumber = Math.floor(10000 + Math.random() * 90000);
    const uniqueId = `${prefix}${randomNumber}`;
    const existingUser = await User.findOne({ uniqueId });
    if (!existingUser) return uniqueId;
  }
};
