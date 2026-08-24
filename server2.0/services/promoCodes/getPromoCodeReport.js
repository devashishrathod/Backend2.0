const mongoose = require("mongoose");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const PromoCode = require("../../models/PromoCode");
const { throwError } = require("../../utils");
const { buildAggregateLookup } = require("../../database");
const {
  PROMO_USAGE_STATUS,
  REPORT_LIMITS,
  REPORT_GROUP_BY,
} = require("../../constants/promoCode");
const { SUBSCRIPTION_HISTORY_ACTION } = require("../../constants/subscription");

/** Money rounded the same way `calculatePricing` rounds it. */
const round2 = (value) => Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;

const DAY_FORMAT = Object.freeze({
  [REPORT_GROUP_BY.DAY]: "%Y-%m-%d",
  [REPORT_GROUP_BY.MONTH]: "%Y-%m",
});

/**
 * How a promo campaign actually performed.
 *
 * Reads the **ledger**, not `PromoCode.usedCount`. The counter is a fast
 * approximation kept for the cap check; the ledger is what happened. Only
 * `CONSUMED` rows are redemptions — a `RESERVED` row is an open checkout and a
 * `RELEASED` one is an abandoned one, and counting either as a redemption would
 * overstate every campaign.
 *
 * Revenue comes from the transaction's frozen `pricing.totalPayable`, so a plan
 * whose price was changed after the fact does not retroactively rewrite what a
 * campaign brought in.
 *
 * The window filters on when the claim was **made** (`createdAt`), not when it
 * was consumed, so a checkout started inside the window and paid just after it
 * still belongs to the campaign that produced it.
 *
 * One aggregation with `$facet` — every section is computed from the same
 * matched set in a single round trip, so the numbers cannot disagree with each
 * other.
 */
exports.getPromoCodeReport = async (query = {}) => {
  const { promoCodeId, code, from, to, groupBy = REPORT_GROUP_BY.DAY } = query;

  const match = {};

  // A specific campaign, by id or by the code an admin actually remembers.
  let promo = null;
  if (promoCodeId || code) {
    promo = await PromoCode.findOne({
      ...(promoCodeId
        ? { _id: new mongoose.Types.ObjectId(String(promoCodeId)) }
        : { code: String(code).toUpperCase().trim() }),
      isDeleted: false,
    }).lean();

    if (!promo) throwError(404, "Promo code not found");
    match.promoCodeId = promo._id;
  }

  const fromDate = from ? new Date(from) : null;
  // `to` is a date, and a report for "up to the 31st" must include the 31st.
  const toDate = to ? new Date(new Date(to).setHours(23, 59, 59, 999)) : null;
  if (fromDate && toDate && fromDate > toDate) {
    throwError(422, "`from` cannot be later than `to`.");
  }
  if (fromDate || toDate) {
    match.createdAt = {
      ...(fromDate ? { $gte: fromDate } : {}),
      ...(toDate ? { $lte: toDate } : {}),
    };
  }

  const dateFormat = DAY_FORMAT[groupBy] || DAY_FORMAT[REPORT_GROUP_BY.DAY];
  const consumed = { $eq: ["$status", PROMO_USAGE_STATUS.CONSUMED] };

  // Revenue lives on the transaction and the purchase type on the subscription
  // history — neither is on the ledger. Joined once, before the facets, so every
  // section is computed from the same enriched documents and cannot disagree.
  const enrich = [
    ...buildAggregateLookup({
      from: "transactions",
      localField: "transactionId",
      as: "txn",
      project: { pricing: 1, verified: 1, gateway: 1 },
    }),
    // The purchase type lives on `SubscribedHistory`, not on `Subscribed`, and is
    // matched on the **transaction** rather than the subscribed row: one
    // subscription accumulates many history rows over its life (activated,
    // upgraded, cancelled), and only the one sharing this transaction is the
    // purchase the promo was actually applied to.
    //
    // Hand-written rather than `buildAggregateLookup` for two reasons that helper
    // cannot express, and both matter here:
    //
    //  1. `ORDER_CREATED` must be excluded. Every paid transaction carries *two*
    //     history rows — one written at order creation and one at activation.
    //  2. No `$unwind`. Even with ORDER_CREATED gone, unwinding would turn one
    //     ledger row into several the moment a transaction ever gained a second
    //     history row, and each copy would be counted again — silently inflating
    //     revenue. Taking the first element keeps one claim as one document no
    //     matter what the history holds.
    {
      $lookup: {
        from: "subscribedhistories",
        let: { txnId: "$transactionId" },
        as: "history",
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$transactionId", "$$txnId"] },
              action: { $ne: SUBSCRIPTION_HISTORY_ACTION.ORDER_CREATED },
            },
          },
          { $sort: { createdAt: 1 } },
          { $limit: 1 },
          { $project: { action: 1 } },
        ],
      },
    },
    { $addFields: { history: { $arrayElemAt: ["$history", 0] } } },
    {
      $addFields: {
        // Only a consumed claim earned revenue. A reserved one has a transaction
        // with a pricing snapshot and no payment behind it.
        revenue: { $cond: [consumed, { $ifNull: ["$txn.pricing.totalPayable", 0] }, 0] },
        discountGiven: { $cond: [consumed, { $ifNull: ["$discountAmount", 0] }, 0] },
        isConsumed: { $cond: [consumed, 1, 0] },
        isReserved: {
          $cond: [{ $eq: ["$status", PROMO_USAGE_STATUS.RESERVED] }, 1, 0],
        },
        isReleased: {
          $cond: [{ $eq: ["$status", PROMO_USAGE_STATUS.RELEASED] }, 1, 0],
        },
      },
    },
  ];

  const totals = {
    claims: { $sum: 1 },
    redemptions: { $sum: "$isConsumed" },
    openReservations: { $sum: "$isReserved" },
    abandoned: { $sum: "$isReleased" },
    discountGiven: { $sum: "$discountGiven" },
    revenueCollected: { $sum: "$revenue" },
  };

  const [result] = await PromoCodeUsage.aggregate([
    { $match: match },
    ...enrich,
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              ...totals,
              distinctCodes: { $addToSet: "$code" },
              distinctBrands: { $addToSet: "$brandId" },
            },
          },
        ],
        byCode: [
          { $group: { _id: { code: "$code", promoCodeId: "$promoCodeId" }, ...totals } },
          { $sort: { redemptions: -1, discountGiven: -1 } },
          { $limit: REPORT_LIMITS.MAX_CODES },
        ],
        byPlan: [
          { $group: { _id: "$subscriptionId", ...totals } },
          { $sort: { redemptions: -1 } },
          ...buildAggregateLookup({
            from: "subscriptions",
            localField: "_id",
            as: "plan",
            project: { name: 1, price: 1, type: 1 },
          }),
        ],
        byAction: [
          {
            // A claim with no history row has not been paid for yet — an open or
            // abandoned checkout. Bucketed rather than dropped, so the section
            // still adds up to the summary.
            $group: { _id: { $ifNull: ["$history.action", "UNPAID"] }, ...totals },
          },
          { $sort: { redemptions: -1 } },
        ],
        overTime: [
          {
            $group: {
              _id: { $dateToString: { format: dateFormat, date: "$createdAt" } },
              ...totals,
            },
          },
          { $sort: { _id: 1 } },
          { $limit: REPORT_LIMITS.MAX_PERIODS },
        ],
        topBrands: [
          { $group: { _id: "$brandId", ...totals } },
          { $sort: { discountGiven: -1, redemptions: -1 } },
          { $limit: REPORT_LIMITS.MAX_BRANDS },
          ...buildAggregateLookup({
            from: "brands",
            localField: "_id",
            as: "brand",
            project: { brandName: 1, email: 1 },
          }),
        ],
      },
    },
  ]);

  const raw = result?.summary?.[0] || {};
  const redemptions = raw.redemptions || 0;
  const claims = raw.claims || 0;
  const discountGiven = round2(raw.discountGiven);
  const revenueCollected = round2(raw.revenueCollected);

  const shape = (row) => ({
    claims: row.claims || 0,
    redemptions: row.redemptions || 0,
    openReservations: row.openReservations || 0,
    abandoned: row.abandoned || 0,
    discountGiven: round2(row.discountGiven),
    revenueCollected: round2(row.revenueCollected),
  });

  return {
    campaign: promo
      ? {
          _id: promo._id,
          code: promo.code,
          description: promo.description,
          discountType: promo.discountType,
          discountPercent: promo.discountPercent,
          discountAmount: promo.discountAmount,
          maxDiscountAmount: promo.maxDiscountAmount,
          validFrom: promo.validFrom,
          validTill: promo.validTill,
          totalUsageLimit: promo.totalUsageLimit,
          usedCount: promo.usedCount,
          isActive: promo.isActive,
        }
      : null,
    period: {
      from: fromDate || null,
      to: toDate || null,
      groupBy,
      // Stated so a reader is never left guessing which date drives the window.
      basis: "The date the promo was claimed at checkout (createdAt).",
    },
    summary: {
      codesUsed: (raw.distinctCodes || []).length,
      brandsReached: (raw.distinctBrands || []).length,
      claims,
      redemptions,
      openReservations: raw.openReservations || 0,
      abandoned: raw.abandoned || 0,
      // Of everyone who applied the code at checkout, who actually paid.
      conversionRate: claims ? round2((redemptions / claims) * 100) : 0,
      discountGiven,
      revenueCollected,
      // What the same redemptions would have brought in at full post-plan-discount
      // price — the cost of the campaign made explicit.
      revenueBeforePromo: round2(revenueCollected + discountGiven),
      averageDiscount: redemptions ? round2(discountGiven / redemptions) : 0,
      averageOrderValue: redemptions ? round2(revenueCollected / redemptions) : 0,
    },
    byCode: (result?.byCode || []).map((row) => ({
      promoCodeId: row._id.promoCodeId,
      code: row._id.code,
      ...shape(row),
    })),
    byPlan: (result?.byPlan || []).map((row) => ({
      subscriptionId: row._id,
      plan: row.plan?.name || null,
      planPrice: row.plan?.price ?? null,
      ...shape(row),
    })),
    byAction: (result?.byAction || []).map((row) => ({
      action: row._id,
      ...shape(row),
    })),
    overTime: (result?.overTime || []).map((row) => ({
      period: row._id,
      ...shape(row),
    })),
    topBrands: (result?.topBrands || []).map((row) => ({
      brandId: row._id,
      brandName: row.brand?.brandName || null,
      ...shape(row),
    })),
  };
};
