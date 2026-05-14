const mongoose = require("mongoose");
const Subscribed = require("../../model/Subscribed");
const { validateObjectId, pagination } = require("../../utils");

exports.getAllSubscribed = async (query = {}) => {
  let {
    page = 1,
    limit = 10,
    user,
    brand,
    subscribedBy,
    upgradedBy,
    transaction,
    subscription,
    upgradedTo,
    durationInDays,
    durationInYears,
    price,
    discount,
    numberOfSubBrands,
    paidAmount,
    dueAmount,
    numberOfUpgrade,
    startDate,
    endDate,
    expiryDate,
    upgradeDate,
    minDurationInDays,
    minDurationInYears,
    minPrice,
    minDiscount,
    minNumberOfSubBrands,
    minPaidAmount,
    minDueAmount,
    minNumberOfUpgrade,
    minStartDate,
    minEndDate,
    minExpiryDate,
    minUpgradeDate,
    maxDurationInDays,
    maxDurationInYears,
    maxPrice,
    maxDiscount,
    maxNumberOfSubBrands,
    maxPaidAmount,
    maxDueAmount,
    maxNumberOfUpgrade,
    maxStartDate,
    maxEndDate,
    maxExpiryDate,
    maxUpgradeDate,
    isActive,
    isExpired,
    isUpgraded,
    isCoolingPlan,
  } = query;
  const match = { isDeleted: false };
  const objectIdFields = {
    user,
    brand,
    subscribedBy,
    upgradedBy,
    transaction,
    subscription,
    upgradedTo,
  };
  Object.entries(objectIdFields).forEach(([key, value]) => {
    if (value) {
      validateObjectId(value, `${key} Id`);
      match[key] = new mongoose.Types.ObjectId(value);
    }
  });
  ["isActive", "isExpired", "isUpgraded", "isCoolingPlan"].forEach((field) => {
    if (typeof eval(field) !== "undefined") {
      match[field] = eval(field);
    }
  });
  // 🔹 Helper for numeric/date range logic
  const applyRange = (field, exact, min, max, isDate = false) => {
    if (
      typeof exact !== "undefined" ||
      typeof min !== "undefined" ||
      typeof max !== "undefined"
    ) {
      match[field] = {};
      if (typeof exact !== "undefined") {
        match[field] = isDate ? new Date(exact) : exact;
        return;
      }
      if (typeof min !== "undefined") {
        match[field].$gte = isDate ? new Date(min) : min;
      }
      if (typeof max !== "undefined") {
        match[field].$lte = isDate ? new Date(max) : max;
      }
    }
  };
  applyRange(
    "durationInDays",
    durationInDays,
    minDurationInDays,
    maxDurationInDays,
  );
  applyRange(
    "durationInYears",
    durationInYears,
    minDurationInYears,
    maxDurationInYears,
  );
  applyRange("price", price, minPrice, maxPrice);
  applyRange("discount", discount, minDiscount, maxDiscount);
  applyRange(
    "numberOfSubBrands",
    numberOfSubBrands,
    minNumberOfSubBrands,
    maxNumberOfSubBrands,
  );
  applyRange("paidAmount", paidAmount, minPaidAmount, maxPaidAmount);
  applyRange("dueAmount", dueAmount, minDueAmount, maxDueAmount);
  applyRange(
    "numberOfUpgrade",
    numberOfUpgrade,
    minNumberOfUpgrade,
    maxNumberOfUpgrade,
  );
  applyRange("startDate", startDate, minStartDate, maxStartDate, true);
  applyRange("endDate", endDate, minEndDate, maxEndDate, true);
  applyRange("expiryDate", expiryDate, minExpiryDate, maxExpiryDate, true);
  applyRange("upgradeDate", upgradeDate, minUpgradeDate, maxUpgradeDate, true);

  const pipeline = [
    { $match: match },
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
        from: "users",
        localField: "subscribedBy",
        foreignField: "_id",
        as: "subscribedBy",
      },
    },
    { $unwind: { path: "$subscribedBy", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "users",
        localField: "upgradedBy",
        foreignField: "_id",
        as: "upgradedBy",
      },
    },
    { $unwind: { path: "$upgradedBy", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "transactions",
        localField: "transaction",
        foreignField: "_id",
        as: "transaction",
      },
    },
    { $unwind: { path: "$transaction", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "subscriptions",
        localField: "subscription",
        foreignField: "_id",
        as: "subscription",
      },
    },
    { $unwind: { path: "$subscription", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "subscribeds",
        localField: "upgradedTo",
        foreignField: "_id",
        as: "upgradedTo",
      },
    },
    { $unwind: { path: "$upgradedTo", preserveNullAndEmptyArrays: true } },

    { $sort: { createdAt: -1 } },
  ];
  return pagination(Subscribed, pipeline, page, limit);
};
