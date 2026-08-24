const mongoose = require("mongoose");
const Transaction = require("../../models/Transaction");
const { buildAggregateLookup } = require("../../database");
const { pagination } = require("../../utils");
const { DISPUTE_STATUS } = require("../../constants/webhook");

/**
 * Open chargebacks, soonest deadline first.
 *
 * A dispute carries a `respond_by` date; miss it and Razorpay closes the case in
 * the customer's favour automatically. Before this the event was acknowledged
 * and forgotten, so the deadline could pass unnoticed — the only signal was the
 * money leaving the account.
 *
 * Defaults to unresolved disputes, since resolved ones need no action.
 */
exports.getDisputes = async (query = {}) => {
  let { page, limit, status, brandId, resolved, sortOrder = "asc" } = query;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 20;

  const match = { isDeleted: false, disputeStatus: { $exists: true } };

  if (status) match.disputeStatus = status;
  else if (resolved === "true" || resolved === true) {
    match.disputeStatus = {
      $in: [DISPUTE_STATUS.WON, DISPUTE_STATUS.LOST, DISPUTE_STATUS.CLOSED],
    };
  } else {
    // The actionable set.
    match.disputeStatus = {
      $in: [
        DISPUTE_STATUS.OPEN,
        DISPUTE_STATUS.UNDER_REVIEW,
        DISPUTE_STATUS.ACTION_REQUIRED,
      ],
    };
  }

  if (brandId) match.brandId = new mongoose.Types.ObjectId(brandId);

  const pipeline = [{ $match: match }];

  pipeline.push(
    ...buildAggregateLookup({
      from: "brands",
      localField: "brandId",
      as: "brand",
      project: { brandName: 1, merchantId: 1, email: 1 },
    }),
    ...buildAggregateLookup({
      from: "subscriptions",
      localField: "subscriptionId",
      as: "plan",
      project: { name: 1, price: 1 },
    }),
  );

  pipeline.push({
    $addFields: {
      daysToRespond: {
        $cond: [
          { $ne: ["$disputeRespondBy", null] },
          {
            $ceil: {
              $divide: [
                { $subtract: ["$disputeRespondBy", new Date()] },
                1000 * 60 * 60 * 24,
              ],
            },
          },
          null,
        ],
      },
    },
  });

  pipeline.push({
    $addFields: {
      // Deadline already gone, or inside 48 hours.
      isOverdue: {
        $and: [
          { $ne: ["$daysToRespond", null] },
          { $lte: ["$daysToRespond", 0] },
        ],
      },
      isUrgent: {
        $and: [
          { $ne: ["$daysToRespond", null] },
          { $gt: ["$daysToRespond", 0] },
          { $lte: ["$daysToRespond", 2] },
        ],
      },
    },
  });

  pipeline.push({
    $project: {
      brand: 1,
      plan: 1,
      invoiceId: 1,
      amount: 1,
      paidAmount: 1,
      disputeId: 1,
      disputeStatus: 1,
      disputeAmount: 1,
      disputeReason: 1,
      disputePhase: 1,
      disputedAt: 1,
      disputeRespondBy: 1,
      disputeResolvedAt: 1,
      daysToRespond: 1,
      isOverdue: 1,
      isUrgent: 1,
      subscribedId: 1,
      createdAt: 1,
    },
  });

  // Soonest deadline first — that is the order they must be worked in.
  pipeline.push({
    $sort: { disputeRespondBy: sortOrder === "desc" ? -1 : 1 },
  });

  return pagination(Transaction, pipeline, page, limit, "dispute");
};
