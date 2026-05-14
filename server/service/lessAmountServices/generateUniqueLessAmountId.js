const LessAmount = require("../../model/LessAmount");
const { findOne } = require("../../db/dbServices");

exports.generateUniqueLessAmountId = async () => {
  const prefix = "#LA";
  while (true) {
    const randomNumber = Math.floor(100000 + Math.random() * 900000);
    const uniqueId = `${prefix}${randomNumber}`;
    const existingLessAmount = await findOne(LessAmount, { uniqueId });
    if (!existingLessAmount) return uniqueId;
  }
};
