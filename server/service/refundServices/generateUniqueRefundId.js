const Refund = require("../../model/Refund");
const { findOne } = require("../../db/dbServices");

exports.generateUniqueRefundId = async () => {
  const prefix = "#R";
  while (true) {
    const randomNumber = Math.floor(100000 + Math.random() * 900000);
    const uniqueId = `${prefix}${randomNumber}`;
    const existingRefund = await findOne(Refund, { uniqueId });
    if (!existingRefund) return uniqueId;
  }
};
