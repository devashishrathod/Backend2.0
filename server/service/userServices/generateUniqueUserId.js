const User = require("../../model/User");
const { findOne } = require("../../db/dbServices");

exports.generateUniqueUserId = async () => {
  const prefix = "#TD";
  while (true) {
    const randomNumber = Math.floor(10000 + Math.random() * 90000);
    const uniqueId = `${prefix}${randomNumber}`;
    const existingUser = await findOne(User, { uniqueId });
    if (!existingUser) return uniqueId;
  }
};
