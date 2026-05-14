const mongoose = require("mongoose");
const Bill = require("../../model/Bill");
const Refund = require("../../model/Refund");
const Transaction = require("../../model/Transaction");
const User = require("../../model/User");
const Brand = require("../../model/Brand");
const SubBrand = require("../../model/SubBrand");
const Subscribed = require("../../model/Subscribed");
const Voucher = require("../../model/Voucher");
const { REFUND_STATUS } = require("../../constants");

const buildMatchQuery = ({
  userId,
  brandId,
  subBrandId,
  startDate,
  endDate,
  date,
}) => {
  const match = {};
  const billMatch = {};
  if (userId) {
    match.user = new mongoose.Types.ObjectId(userId);
    billMatch.userId = new mongoose.Types.ObjectId(userId);
  }
  if (brandId) {
    match.brand = new mongoose.Types.ObjectId(brandId);
    billMatch.brandId = new mongoose.Types.ObjectId(brandId);
  }
  if (subBrandId) {
    match.subBrand = new mongoose.Types.ObjectId(subBrandId);
    billMatch.subBrandId = new mongoose.Types.ObjectId(subBrandId);
  }
  if (date) {
    const createdAt = {
      $gte: new Date(date),
      $lt: new Date(new Date(date).setDate(new Date(date).getDate() + 1)),
    };
    match.createdAt = createdAt;
    billMatch.createdAt = createdAt;
  } else if (startDate && endDate) {
    const createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
    match.createdAt = createdAt;
    billMatch.createdAt = createdAt;
  }
  return { match, billMatch };
};

exports.getDashboardAnalytics = async (filters = {}) => {
  const { match, billMatch } = buildMatchQuery(filters);
  const billAgg = await Bill.aggregate([
    { $match: billMatch },
    {
      $group: {
        _id: null,
        billValues: { $sum: "$billAmount" },
        earnValues: { $sum: "$finalPayable" },
        billProfits: { $sum: "$totalDiscountValue" },
        claimedCount: { $sum: 1 },
      },
    },
  ]);
  const refundAgg = await Refund.aggregate([
    {
      $facet: {
        refundValue: [
          {
            $match: {
              ...match,
              status: REFUND_STATUS.APPROVED,
              isApproved: true,
            },
          },
          {
            $group: {
              _id: null,
              refundValue: { $sum: "$refundAmount" },
            },
          },
        ],
        refundCount: [
          { $match: { ...match } },
          {
            $group: {
              _id: null,
              refundCount: { $sum: 1 },
            },
          },
        ],
      },
    },
    {
      $project: {
        refundValue: { $arrayElemAt: ["$refundValue.refundValue", 0] },
        refundCount: { $arrayElemAt: ["$refundCount.refundCount", 0] },
      },
    },
  ]);
  const txnAgg = await Transaction.aggregate([
    {
      $match: {
        ...match,
        bill: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: null,
        overallTransaction: { $sum: "$paidAmount" },
      },
    },
  ]);
  const [overallUsers, brands, subBrands, vouchers, subscriptionAgg] =
    await Promise.all([
      User.countDocuments({ role: "user" }),
      Brand.countDocuments(
        filters.brandId
          ? { _id: new mongoose.Types.ObjectId(filters.brandId) }
          : {},
      ),
      SubBrand.countDocuments(
        filters.brandId
          ? { brand: new mongoose.Types.ObjectId(filters.brandId) }
          : {},
      ),
      Voucher.countDocuments(
        filters.subBrandId
          ? { subBrands: new mongoose.Types.ObjectId(filters.brandId) }
          : filters.brandId
            ? { brand: new mongoose.Types.ObjectId(filters.brandId) }
            : {},
      ),
      Subscribed.aggregate([
        {
          $match: filters.brandId
            ? { brand: new mongoose.Types.ObjectId(filters.brandId) }
            : {},
        },
        { $group: { _id: null, subscriptionAmount: { $sum: "$price" } } },
      ]),
    ]);
  return {
    billValues: billAgg[0]?.billValues || 0,
    earnValues: billAgg[0]?.earnValues || 0,
    billProfits: billAgg[0]?.billProfits || 0,
    claimedCount: billAgg[0]?.claimedCount || 0,
    refundValue: refundAgg[0]?.refundValue || 0,
    refundCount: refundAgg[0]?.refundCount || 0,
    overallTransaction: txnAgg[0]?.overallTransaction || 0,
    overallUsers,
    brands,
    subBrands,
    vouchers,
    subscriptionAmount: subscriptionAgg[0]?.subscriptionAmount || 0,
  };
};
