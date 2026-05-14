const mongoose = require("mongoose");
const LessAmount = require("../../model/LessAmount");
const { pagination } = require("../../utils");

exports.getAllLessAmount = async (query) => {
  const {
    page = 1,
    limit = 10,
    search,
    scope,
    isActive,
    voucher,
    validFrom,
    validTill,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;
  const matchStage = {};
  if (voucher && mongoose.Types.ObjectId.isValid(voucher)) {
    matchStage.voucher = new mongoose.Types.ObjectId(voucher);
  }
  if (scope) matchStage.scope = scope;
  if (typeof isActive !== "undefined") {
    matchStage.isActive = isActive === "true";
  }
  if (validFrom || validTill) {
    matchStage.$and = [];
    if (validFrom) {
      matchStage.$and.push({ validFrom: { $gte: new Date(validFrom) } });
    }
    if (validTill) {
      matchStage.$and.push({ validTill: { $lte: new Date(validTill) } });
    }
  }
  if (search) {
    matchStage.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
      { uniqueId: { $regex: search, $options: "i" } },
    ];
  }
  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: "vouchers",
        localField: "voucher",
        foreignField: "_id",
        as: "voucher",
      },
    },
    { $unwind: { path: "$voucher", preserveNullAndEmptyArrays: true } },
    {
      $sort: {
        [sortBy]: sortOrder === "asc" ? 1 : -1,
      },
    },
  ];
  return await pagination(LessAmount, pipeline, page, limit);
};
