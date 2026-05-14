const PromoCode = require("../../model/PromoCode");
const { findOne } = require("../../db/dbServices");

exports.generateUniquePromoCodeId = async () => {
  const prefix = "#CC";
  while (true) {
    const randomNumber = Math.floor(100000 + Math.random() * 900000);
    const uniqueId = `${prefix}${randomNumber}`;
    const existingPromoCode = await findOne(PromoCode, { uniqueId });
    if (!existingPromoCode) return uniqueId;
  }
};
