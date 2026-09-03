const mongoose = require("mongoose");
const Subscribed = require("../../models/Subscribed");
const { buildAggregateLookup } = require("../../database");
const { pagination } = require("../../utils");

/**
 * Vendors who lost paid-for days by changing plan mid-term.
 *
 * Upgrading ends the current plan immediately and the policy says so upfront, so
 * no proration is applied and no refund is owed. This is the goodwill list: it
 * surfaces exactly who gave up how many days and what that was worth, so those
 * vendors can be compensated later with credit or an extension if the business
 * chooses to.
 *
 * `forfeitCompensatedAt` marks a row as dealt with, so the list is a worklist
 * rather than a growing pile.
 */
exports.getForfeitedSubscriptions = async (query = {}) => {
  let {
    page,
    limit,
    brandId,
    compensated,
    minDays,
    fromDate,
    toDate,
    sortBy = "forfeitedValue",
    sortOrder = "desc",
  } = query;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 20;

  const match = {
    isDeleted: false,
    forfeitedDays: { $gt: Number(minDays) > 0 ? Number(minDays) - 1 : 0 },
  };

  if (brandId) match.brandId = new mongoose.Types.ObjectId(brandId);

  // Default view is "not yet compensated" — that is the actionable set.
  if (compensated === true || compensated === "true") {
    match.forfeitCompensatedAt = { $ne: null };
  } else if (compensated === false || compensated === "false") {
    match.forfeitCompensatedAt = null;
  }

  if (fromDate || toDate) {
    match.upgradeDate = {};
    if (fromDate) match.upgradeDate.$gte = new Date(fromDate);
    if (toDate) match.upgradeDate.$lte = new Date(toDate);
  }

  const pipeline = [{ $match: match }];

  pipeline.push(
    ...buildAggregateLookup({
      from: "brands",
      localField: "brandId",
      as: "brand",
      project: { brandName: 1, legalBusinessName: 1, merchantId: 1, email: 1 },
    }),
    ...buildAggregateLookup({
      from: "subscriptions",
      localField: "subscriptionId",
      as: "forfeitedPlan",
      project: { name: 1, price: 1, type: 1 },
    }),
    ...buildAggregateLookup({
      from: "subscribeds",
      localField: "upgradedTo",
      as: "replacedBy",
      project: { subscriptionId: 1, startDate: 1, endDate: 1, status: 1 },
    }),
  );

  pipeline.push({
    $project: {
      brand: 1,
      forfeitedPlan: 1,
      replacedBy: 1,
      status: 1,
      startDate: 1,
      // The date the plan was cut short.
      upgradeDate: 1,
      forfeitedDays: 1,
      forfeitedValue: 1,
      forfeitCompensatedAt: 1,
      forfeitCompensationNote: 1,
      price: 1,
      paidAmount: 1,
      pricing: 1,
    },
  });

  pipeline.push({ $sort: { [sortBy]: sortOrder === "asc" ? 1 : -1 } });

  return pagination(Subscribed, pipeline, page, limit, "forfeited subscription");
};
