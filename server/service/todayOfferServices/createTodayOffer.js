const TodayOffer = require("../../model/TodayOffer");
const { generateUniqueTodayOfferId } = require("./generateUniqueTodayOfferId");

exports.createTodayOffer = async (data) => {
  let { dealOfCategory, vouchers, title, description, validFrom, validTill } =
    data;
  vouchers = Array.isArray(vouchers) ? vouchers : [vouchers];
  const now = new Date();
  if (!validFrom || !validTill) {
    throw new Error("Both validFrom and validTill are required.");
  }
  const from = new Date(validFrom);
  const till = new Date(validTill);
  if (from < now.setHours(0, 0, 0, 0)) {
    throw new Error("validFrom cannot be in the past.");
  }
  if (till <= from) {
    throw new Error("validTill must be after validFrom.");
  }
  const newOffer = await TodayOffer.create({
    dealOfCategory,
    vouchers,
    title,
    description,
    validFrom: from,
    validTill: till,
    uniqueId: await generateUniqueTodayOfferId(),
  });
  return newOffer;
};
