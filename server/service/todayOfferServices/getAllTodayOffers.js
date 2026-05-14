const mongoose = require("mongoose");
const TodayOffer = require("../../model/TodayOffer");
const { pagination } = require("../../utils");

exports.getAllTodayOffers = async (filters) => {
  page = Number(filters.page) || 1;
  limit = Number(filters.limit) || 10;
  if (page < 1) page = 1;
  if (limit < 1) limit = 10;
  const match = { isDeleted: false };
  if (filters.isActive !== undefined) {
    match.isActive = filters.isActive === "true";
  }
  if (filters.dealOfCategoryId) {
    match.dealOfCategory = new mongoose.Types.ObjectId(
      filters.dealOfCategoryId
    );
  }
  if (filters.date) {
    const date = new Date(filters.date);
    match.validFrom = { $lte: date };
    match.validTill = { $gte: date };
  }
  if (filters.startDate && filters.endDate) {
    match.$and = [
      { validFrom: { $gte: new Date(filters.startDate) } },
      { validTill: { $lte: new Date(filters.endDate) } },
    ];
  }
  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: "vouchers",
        localField: "vouchers",
        foreignField: "_id",
        as: "vouchers",
        pipeline: [{ $project: { _id: 1, title: 1, uniqueId: 1 } }],
      },
    },
    { $sort: { createdAt: -1 } },
  ];
  return await pagination(TodayOffer, pipeline, page, limit);
};
