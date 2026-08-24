const mongoose = require("mongoose");
const SubscribedHistory = require("../../models/SubscribedHistory");
const { buildAggregateLookup } = require("../../database");
const { pagination } = require("../../utils");
const { ROLES } = require("../../constants");
const { resolveActorBrand } = require("../../helpers/brands");

/**
 * The audit trail for one brand's subscription — every order, activation,
 * upgrade, downgrade, admin grant, expiry and cancellation, newest first.
 *
 * Vendors see their own brand only (enforced by `resolveActorBrand`) and admin
 * internals are projected away: `adminNote` and the raw `snapshot` can carry
 * commercial context that is not the vendor's business.
 */
exports.getSubscribedHistory = async (actor, query = {}) => {
  const brand = await resolveActorBrand(actor, query.brandId);
  const isAdmin = actor.role === ROLES.ADMIN;

  let { page, limit, action } = query;
  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 20;

  const match = { brandId: new mongoose.Types.ObjectId(String(brand._id)) };
  if (action) match.action = action;

  const pipeline = [{ $match: match }];

  pipeline.push(
    ...buildAggregateLookup({
      from: "subscriptions",
      localField: "toSubscriptionId",
      as: "toPlan",
      project: { name: 1, type: 1, price: 1 },
    }),
    ...buildAggregateLookup({
      from: "subscriptions",
      localField: "fromSubscriptionId",
      as: "fromPlan",
      project: { name: 1, type: 1, price: 1 },
    }),
  );

  if (isAdmin) {
    pipeline.push(
      ...buildAggregateLookup({
        from: "users",
        localField: "performedBy",
        as: "performedByUser",
        project: { password: 0, otp: 0, refreshToken: 0 },
      }),
    );
  }

  pipeline.push({
    $project: {
      action: 1,
      performedByRole: 1,
      ...(isAdmin ? { performedByUser: 1, reason: 1, snapshot: 1 } : {}),
      fromPlan: 1,
      toPlan: 1,
      source: 1,
      paymentMode: 1,
      amount: 1,
      startDate: 1,
      endDate: 1,
      createdAt: 1,
    },
  });

  pipeline.push({ $sort: { createdAt: -1 } });

  return pagination(
    SubscribedHistory,
    pipeline,
    page,
    limit,
    "subscription history record",
  );
};
