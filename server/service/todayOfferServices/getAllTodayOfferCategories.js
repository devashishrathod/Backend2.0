const TodayOffer = require("../../model/TodayOffer");
const DealOfCategory = require("../../model/DealOfCategory");

exports.getAllTodayOfferCategories = async () => {
  const now = new Date();
  const categoryIds = await TodayOffer.distinct("dealOfCategory", {
    validFrom: { $lte: now },
    validTill: { $gte: now },
    isActive: true,
    isDeleted: false,
  });
  return await DealOfCategory.find({
    _id: { $in: categoryIds },
    //  isActive: true,
    isDeleted: false,
  });
};
