const mongoose = require("mongoose");
const Transaction = require("../../model/Transaction");
const { pagination } = require("../../utils");
const { PAYMENT_STATUS } = require("../../constants");

exports.getOverallPerDayBrandsTransaction = async (filters) => {
  const {
    page,
    limit,
    date,
    startDate,
    endDate,
    brandId,
    brandName,
    search,
    isPaidToVendor,
  } = filters;
  const matchStage = {
    isDeleted: false,
    isActive: true,
    status: PAYMENT_STATUS.CAPTURED,
    subscription: { $exists: false },
  };
  if (typeof isPaidToVendor !== "undefined") {
    matchStage.isPaidToVendor = isPaidToVendor === "true";
  }
  if (date) {
    const start = new Date(date);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    matchStage.createdAt = { $gte: start, $lte: end };
  }
  if (startDate && endDate) {
    matchStage.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  }
  if (brandId && mongoose.Types.ObjectId.isValid(brandId)) {
    matchStage.brand = new mongoose.Types.ObjectId(brandId);
  }
  const pipeline = [
    { $match: matchStage },
    {
      $addFields: {
        paymentDate: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$createdAt",
          },
        },
      },
    },
    {
      $group: {
        _id: {
          brand: "$brand",
          paymentDate: "$paymentDate",
        },
        totalAmount: { $sum: "$amount" },
        claimedUsersCount: { $addToSet: "$user" },
        subBrands: { $addToSet: "$subBrand" },
        transactions: { $push: "$_id" },
      },
    },
    {
      $project: {
        _id: 0,
        brand: "$_id.brand",
        paymentDate: "$_id.paymentDate",
        totalAmount: 1,
        claimedUsersCount: { $size: "$claimedUsersCount" },
        subBrandCount: { $size: "$subBrands" },
        transactions: 1,
      },
    },
    {
      $lookup: {
        from: "brands",
        localField: "brand",
        foreignField: "_id",
        as: "brandData",
      },
    },
    { $unwind: "$brandData" },
    ...(brandName
      ? [
          {
            $match: {
              "brandData.name": { $regex: brandName, $options: "i" },
            },
          },
        ]
      : []),
    ...(search
      ? [
          {
            $match: {
              $or: [
                { "brandData.name": { $regex: search, $options: "i" } },
                { "brandData.uniqueId": { $regex: search, $options: "i" } },
              ],
            },
          },
        ]
      : []),
    {
      $project: {
        brandId: "$brandData._id",
        brandName: "$brandData.name",
        brandLogo: "$brandData.logo",
        brandUniqueId: "$brandData.uniqueId",
        paymentDate: 1,
        totalAmount: 1,
        claimedUsersCount: 1,
        subBrandCount: 1,
        transactions: 1,
      },
    },
    { $sort: { paymentDate: -1 } },
  ];
  return await pagination(Transaction, pipeline, page, limit);
};
