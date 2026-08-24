const PromoCode = require("../../models/PromoCode");
const { pagination } = require("../../utils");
const { buildAggregateLookup } = require("../../database");
const { PROMO_USAGE_STATUS } = require("../../constants/promoCode");

/**
 * Admin listing of promo codes with their live redemption state.
 *
 * `consumedCount` and `reservedCount` come from the ledger rather than the
 * `usedCount` counter, so an admin can see the difference between codes that
 * were actually redeemed and codes sitting in open checkouts.
 */
exports.getAllPromoCodes = async (query = {}) => {
  let {
    page,
    limit,
    search,
    isActive,
    status,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 20;

  const now = new Date();
  const match = { isDeleted: false };

  if (typeof isActive !== "undefined") {
    match.isActive = isActive === "true" || isActive === true;
  }
  if (search) {
    const regex = new RegExp(search, "i");
    match.$or = [{ code: regex }, { description: regex }];
  }

  // "status" is the effective state, which the stored flags alone do not give.
  if (status === "EXPIRED") {
    match.validTill = { $lt: now };
  } else if (status === "SCHEDULED") {
    match.validFrom = { $gt: now };
  } else if (status === "LIVE") {
    match.isActive = true;
    match.$and = [
      { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
      { $or: [{ validTill: null }, { validTill: { $gte: now } }] },
    ];
  }

  const pipeline = [{ $match: match }];

  pipeline.push(
    ...buildAggregateLookup({
      from: "subscriptions",
      localField: "subscriptionIds",
      as: "plans",
      project: { name: 1, price: 1, type: 1 },
    }),
  );

  // Redemption counts straight from the ledger.
  pipeline.push({
    $lookup: {
      from: "promocodeusages",
      let: { promoId: "$_id" },
      as: "usageStats",
      pipeline: [
        { $match: { $expr: { $eq: ["$promoCodeId", "$$promoId"] } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ],
    },
  });

  pipeline.push({
    $addFields: {
      consumedCount: {
        $ifNull: [
          {
            $first: {
              $map: {
                input: {
                  $filter: {
                    input: "$usageStats",
                    cond: { $eq: ["$$this._id", PROMO_USAGE_STATUS.CONSUMED] },
                  },
                },
                in: "$$this.count",
              },
            },
          },
          0,
        ],
      },
      reservedCount: {
        $ifNull: [
          {
            $first: {
              $map: {
                input: {
                  $filter: {
                    input: "$usageStats",
                    cond: { $eq: ["$$this._id", PROMO_USAGE_STATUS.RESERVED] },
                  },
                },
                in: "$$this.count",
              },
            },
          },
          0,
        ],
      },
      remainingUses: {
        $cond: [
          { $gt: ["$totalUsageLimit", null] },
          { $max: [0, { $subtract: ["$totalUsageLimit", "$usedCount"] }] },
          null,
        ],
      },
      isExpired: {
        $and: [{ $ne: ["$validTill", null] }, { $lt: ["$validTill", now] }],
      },
    },
  });

  pipeline.push({ $project: { usageStats: 0 } });
  pipeline.push({ $sort: { [sortBy]: sortOrder === "asc" ? 1 : -1 } });

  return pagination(PromoCode, pipeline, page, limit, "promo code");
};
