const Voucher = require("../../model/Voucher");
const { findOne } = require("../../db/dbServices");

exports.generateUniqueVoucherId = async () => {
  const prefix = "#V";
  while (true) {
    const randomNumber = Math.floor(10000000 + Math.random() * 90000000);
    const uniqueId = `${prefix}${randomNumber}`;
    const existingVoucher = await findOne(Voucher, { uniqueId });
    if (!existingVoucher) {
      return uniqueId;
    }
  }
};
