const mongoose = require("mongoose");
const Transaction = require("../../model/Transaction");
const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");

exports.getClaimedVouchersByUser = async (role, tokenUserId, filter) => {
  let {
    page,
    limit,
    userId,
    brandId,
    subBrandId,
    categoryId,
    voucherId,
    startDate,
    endDate,
    date,
    paymentMethod,
    isRefunded,
    voucherType,
    minAmount,
    maxAmount,
    rating,
    discount,
    sortBy,
    sortOrder,
  } = filter;
  page = page ? parseInt(page) : 1;
  limit = limit ? parseInt(limit) : 10;
  minAmount = minAmount ? parseInt(minAmount) : undefined;
  maxAmount = maxAmount ? parseInt(maxAmount) : undefined;
  rating = rating ? parseInt(rating) : undefined;
  discount = discount ? parseInt(discount) : undefined;
  const skip = (page - 1) * limit;
  const matchData = {
    isDeleted: false,
    isActive: true,
    subscription: { $exists: false },
  };
  if (paymentMethod) matchData.paymentMethod = paymentMethod;
  if (isRefunded) matchData.isRefunded = isRefunded;
  if (voucherType) matchData.voucherType = voucherType;
  if (discount) matchData["voucher.discount"] = { $gte: parseInt(discount) };
  if (rating) matchData["feedback.rating"] = rating;
  if (minAmount !== undefined && maxAmount !== undefined) {
    matchData.paidAmount = { $gte: minAmount, $lte: maxAmount };
  } else if (minAmount !== undefined) {
    matchData.paidAmount = { $gte: minAmount };
  } else if (maxAmount !== undefined) {
    matchData.paidAmount = { $lte: maxAmount };
  }
  let sortStage = { createdAt: -1 };
  if (Array.isArray(sortBy)) {
    sortStage = {};
    sortBy.forEach((field, idx) => {
      let order = sortOrder && sortOrder[idx] === "asc" ? 1 : -1;
      switch (field) {
        case "rating":
          sortStage["feedback.rating"] = order;
          break;
        case "offer":
          sortStage["voucher.discount"] = order;
          break;
        case "feedback":
          sortStage["feedback.rating"] = order;
          break;
        case "price":
          sortStage["paidAmount"] = order;
          break;
        default:
          sortStage.createdAt = -1;
      }
    });
  } else if (sortBy) {
    let order = sortOrder === "asc" ? 1 : -1;
    switch (sortBy) {
      case "rating":
        sortStage = { "feedback.rating": order };
        break;
      case "offer":
        sortStage = { "voucher.discount": order };
        break;
      case "feedback":
        sortStage = { "feedback.rating": order };
        break;
      case "price":
        sortStage = { paidAmount: order };
        break;
      default:
        sortStage = { createdAt: -1 };
    }
  }
  if (
    userId &&
    ROLES.USER === role &&
    userId?.toString() === tokenUserId?.toString()
  ) {
    matchData.user = new mongoose.Types.ObjectId(userId);
    matchData.isRemoved = false;
  } else if (userId) matchData.user = new mongoose.Types.ObjectId(userId);
  if (brandId) matchData.brand = new mongoose.Types.ObjectId(brandId);
  if (subBrandId) matchData.subBrand = new mongoose.Types.ObjectId(subBrandId);
  if (voucherId) {
    matchData.voucher = new mongoose.Types.ObjectId(voucherId);
  }
  if (categoryId) {
    matchData["subBrand.category"] = new mongoose.Types.ObjectId(categoryId);
  }
  if (startDate && endDate) {
    matchData.createdAt = {
      $gte: new Date(new Date(startDate).setHours(0, 0, 0, 0)),
      $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)),
    };
  } else if (date) {
    matchData.createdAt = {
      $gte: new Date(new Date(date).setHours(0, 0, 0, 0)),
      $lte: new Date(new Date(date).setHours(23, 59, 59, 999)),
    };
  }
  const result = await Transaction.aggregate([
    { $match: matchData },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "brands",
        localField: "brand",
        foreignField: "_id",
        as: "brand",
      },
    },
    { $unwind: { path: "$brand", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "subbrands",
        localField: "subBrand",
        foreignField: "_id",
        as: "subBrand",
      },
    },
    { $unwind: { path: "$subBrand", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "categories",
        localField: "subBrand.category",
        foreignField: "_id",
        as: "category",
      },
    },
    { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "locations",
        localField: "subBrand.location",
        foreignField: "_id",
        as: "location",
      },
    },
    { $unwind: { path: "$location", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "bills",
        localField: "bill",
        foreignField: "_id",
        as: "bill",
      },
    },
    { $unwind: { path: "$bill", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "vouchers",
        localField: "bill.voucherId",
        foreignField: "_id",
        as: "voucher",
      },
    },
    { $unwind: { path: "$voucher", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "feedbacks",
        let: { brandId: "$voucher.brand" },
        pipeline: [
          { $match: { $expr: { $eq: ["$brand", "$$brandId"] } } },
          { $sort: { createdAt: -1 } },
          { $limit: 1 },
        ],
        as: "feedback",
      },
    },
    { $unwind: { path: "$feedback", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        day: {
          $let: {
            vars: {
              daysOfWeek: [
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ],
            },
            in: {
              $arrayElemAt: [
                "$$daysOfWeek",
                { $subtract: [{ $dayOfWeek: "$createdAt" }, 1] },
              ],
            },
          },
        },
        datePart: { $dateToString: { format: "%d-%b-%Y", date: "$createdAt" } },
        minutePart: { $dateToString: { format: "%M", date: "$createdAt" } },
        hour24: { $hour: "$createdAt" },
      },
    },
    {
      $addFields: {
        ampm: { $cond: [{ $gte: ["$hour24", 12] }, "PM", "AM"] },
        hourFormatted: {
          $cond: [
            { $eq: [{ $mod: ["$hour24", 12] }, 0] },
            12,
            { $mod: ["$hour24", 12] },
          ],
        },
      },
    },
    {
      $addFields: {
        formattedDate: {
          $concat: [
            "$datePart",
            " - ",
            { $toString: "$hourFormatted" },
            ":",
            "$minutePart",
            " ",
            "$ampm",
          ],
        },
      },
    },
    {
      $addFields: {
        voucherType: {
          $switch: {
            branches: [
              { case: { $eq: ["$voucher.isActive", true] }, then: "In store" },
              {
                case: { $eq: ["$voucher.isActive", false] },
                then: "Out of stock",
              },
              {
                case: { $lte: ["$paidAmount", 1000] },
                then: "Very Low Price",
              },
              {
                case: { $gte: ["$paidAmount", 100000] },
                then: "Very High Price",
              },
            ],
            default: "In store",
          },
        },
      },
    },
    { $sort: sortStage },
    {
      $project: {
        _id: 0,
        userName: "$user.name",
        userProfilePic: "$user.image",
        orderId: "$razorpayOrderId",
        dateTime: "$formattedDate",
        day: "$day",
        category: "$category.name",
        percentage: "$voucher.discount",
        price: { $ifNull: ["$paidAmount", "$bill.finalPayble"] },
        voucherId: "$voucher._id",
        voucherUniqueId: "$voucher.uniqueId",
        voucherType: {
          $cond: [
            { $eq: ["$voucher.isActive", true] },
            "In store",
            "Out of stock",
          ],
        },
        claimedType: "$paymentMethod",
        transactionId: "$_id",
        paymentStatus: {
          $cond: [{ $eq: ["$status", "captured"] }, "Success", "Failed"],
        },
        invoiceId: "$invoiceId",
        invoiceUrl: "$invoiceUrl",
        subBrandAdd: "$location.address",
        subBrandShopNumber: "$location.shopOrBuildingNumber",
        subBrandCity: "$location.city",
        brandName: "$subBrand.companyName",
        brandUniqueId: "$brand.uniqueId",
        brandLogo: "$brand.logo",
        subBrandUniqueId: "$subBrand.uniqueId",
        billSummary: {
          voucherDiscountValue: "$bill.voucherDiscountValue",
          billAmount: "$bill.billAmount",
          appliedOffers: "$bill.appliedOffers",
          convenienceFee: "$bill.convenienceFee",
          totalDiscountValue: "$bill.totalDiscountValue",
          finalPayable: "$bill.finalPayable",
          isVerified: "$bill.isVerified",
          isDeleted: "$bill.isDeleted",
          createdAt: "$bill.createdAt",
        },
      },
    },
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: limit }],
        totalCount: [{ $count: "total" }],
      },
    },
    {
      $addFields: {
        total: { $ifNull: [{ $arrayElemAt: ["$totalCount.total", 0] }, 0] },
        totalPage: {
          $ceil: {
            $divide: [
              { $ifNull: [{ $arrayElemAt: ["$totalCount.total", 0] }, 0] },
              limit,
            ],
          },
        },
        limit: limit,
        page: page,
      },
    },
    {
      $project: { total: 1, totalPage: 1, limit: 1, page: 1, data: 1 },
    },
  ]);
  const { data, total, totalPage } = result[0] || {};
  if (!data || data.length === 0) {
    throwError(404, "No any voucher claimed yet");
  }
  return {
    total,
    totalPage,
    page,
    limit,
    data,
  };
};
