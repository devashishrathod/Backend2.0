const mongoose = require("mongoose");
const Subscribed = require("../../models/Subscribed");
const { buildAggregateLookup } = require("../../database");
const { pagination } = require("../../utils");
const { SUBSCRIBED_STATUS } = require("../../constants/subscription");

/**
 * Admin work-queue listing of every subscription instance.
 *
 * Read-only, so it deliberately does **not** self-heal stale rows — a listing
 * must not write. `isLapsed` is computed in the pipeline instead: it flags rows
 * still marked ACTIVE whose end date has passed, i.e. exactly what the expiry
 * job has yet to sweep.
 */
exports.getAllSubscribeds = async (query = {}) => {
  let {
    page,
    limit,
    search,
    brandId,
    subscriptionId,
    status,
    source,
    expiringInDays,
    fromDate,
    toDate,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 10;

  const now = new Date();
  const match = { isDeleted: false };

  if (brandId) match.brandId = new mongoose.Types.ObjectId(brandId);
  if (subscriptionId) {
    match.subscriptionId = new mongoose.Types.ObjectId(subscriptionId);
  }
  if (status) match.status = status;
  if (source) match.source = source;

  if (fromDate || toDate) {
    match.createdAt = {};
    if (fromDate) match.createdAt.$gte = new Date(fromDate);
    if (toDate) match.createdAt.$lte = new Date(toDate);
  }

  // "which paying brands am I about to lose" — the renewals worklist.
  if (expiringInDays) {
    match.status = SUBSCRIBED_STATUS.ACTIVE;
    match.endDate = {
      $gt: now,
      $lte: new Date(now.getTime() + Number(expiringInDays) * 86400000),
    };
  }

  const pipeline = [{ $match: match }];

  pipeline.push(
    ...buildAggregateLookup({
      from: "brands",
      localField: "brandId",
      as: "brand",
      project: {
        brandName: 1,
        legalBusinessName: 1,
        merchantId: 1,
        uniqueId: 1,
        isSubscribed: 1,
        subBrandsUsed: 1,
        subBrandsLimit: 1,
        franchisesUsed: 1,
        franchisesLimit: 1,
      },
    }),
    ...buildAggregateLookup({
      from: "subscriptions",
      localField: "subscriptionId",
      as: "plan",
      project: { name: 1, type: 1, price: 1 },
    }),
  );

  if (search) {
    const regex = new RegExp(search, "i");
    pipeline.push({
      $match: {
        $or: [
          { "brand.brandName": regex },
          { "brand.legalBusinessName": regex },
          { "brand.merchantId": regex },
          { "plan.name": regex },
          { referenceNumber: regex },
        ],
      },
    });
  }

  pipeline.push({
    $addFields: {
      daysRemaining: {
        $let: {
          vars: {
            diff: {
              $divide: [{ $subtract: ["$endDate", now] }, 1000 * 60 * 60 * 24],
            },
          },
          in: { $max: [0, { $ceil: "$$diff" }] },
        },
      },
      // Still flagged ACTIVE but already past its end date — awaiting the sweep.
      isLapsed: {
        $and: [
          { $eq: ["$status", SUBSCRIBED_STATUS.ACTIVE] },
          { $lte: ["$endDate", now] },
        ],
      },
    },
  });

  pipeline.push({
    $project: {
      brand: 1,
      plan: 1,
      status: 1,
      source: 1,
      paymentMode: 1,
      isFreeGrant: 1,
      referenceNumber: 1,
      adminNote: 1,
      startDate: 1,
      endDate: 1,
      daysRemaining: 1,
      isLapsed: 1,
      price: 1,
      paidAmount: 1,
      dueAmount: 1,
      pricing: 1,
      transactionId: 1,
      grantedByAdminId: 1,
      numberOfUpgrade: 1,
      createdAt: 1,
    },
  });

  pipeline.push({ $sort: { [sortBy]: sortOrder === "asc" ? 1 : -1 } });

  return pagination(Subscribed, pipeline, page, limit, "subscription");
};
