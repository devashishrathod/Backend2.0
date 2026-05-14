const TodayOffer = require("../../model/TodayOffer");
const { findOne } = require("../../db/dbServices");

exports.generateUniqueTodayOfferId = async () => {
  const prefix = "#TO";
  while (true) {
    const randomNumber = Math.floor(100000 + Math.random() * 900000);
    const uniqueId = `${prefix}${randomNumber}`;
    const existingTodayOffer = await findOne(TodayOffer, { uniqueId });
    if (!existingTodayOffer) return uniqueId;
  }
};
