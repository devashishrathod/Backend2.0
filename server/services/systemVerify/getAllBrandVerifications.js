const mongoose = require("mongoose");
const SystemVerify = require("../../models/SystemVerify");
const { buildAggregateLookup } = require("../../database");
const { pagination, validateObjectId } = require("../../utils");
const {
  BRAND_VERIFICATION_ACTION,
  BRAND_VERIFICATION_SORT_BY,
  BRAND_VERIFICATION_SORT_ORDER,
} = require("../../constants/brandVerification");

const toBoolean = (value) => value === true || value === "true";

// Records created before these flags existed have the field absent, and in
// Mongo an absent field does not equal false — so a "false" filter asks for
// "not true" instead, keeping older records visible.
const boolFilter = (value) => (value ? true : { $ne: true });

// Sums the grouped history counts for one action. `base` covers the first
// submission, which is logged as SYSTEM_VERIFIED rather than RESUBMITTED.
const countOf = (action, base = 0) => ({
  $reduce: {
    input: "$historyCounts",
    initialValue: base,
    in: {
      $cond: [
        { $eq: ["$$this._id", action] },
        { $add: ["$$value", "$$this.count"] },
        "$$value",
      ],
    },
  },
});

/**
 * Admin work-queue of brand verifications.
 *
 * Defaults to the live attempt of each brand (superseded records are hidden
 * unless explicitly asked for), so the panel lists exactly what is actionable.
 */
exports.getAllBrandVerifications = async (query = {}) => {
  let {
    page,
    limit,
    search,
    brandId,
    status,
    reviewedByAdminId,
    isReviewed,
    isRejected,
    isRevoked,
    isAdminApproved,
    isSuperseded,
    attemptNumber,
    minScore,
    maxScore,
    fromDate,
    toDate,
    sortBy,
    sortOrder,
  } = query;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 10;

  const match = { isDeleted: false };

  if (brandId) {
    validateObjectId(brandId, "Brand Id");
    match.brandId = new mongoose.Types.ObjectId(brandId);
  }
  if (reviewedByAdminId) {
    validateObjectId(reviewedByAdminId, "Reviewed By Id");
    match.reviewedByAdminId = new mongoose.Types.ObjectId(reviewedByAdminId);
  }
  if (status) match.status = status;
  if (attemptNumber) match.attemptNumber = Number(attemptNumber);
  if (isReviewed !== undefined) {
    match.isReviewed = boolFilter(toBoolean(isReviewed));
  }
  if (isRejected !== undefined) {
    match.isRejected = boolFilter(toBoolean(isRejected));
  }
  if (isRevoked !== undefined) {
    match.isRevoked = boolFilter(toBoolean(isRevoked));
  }
  if (isAdminApproved !== undefined) {
    match.isAdminApproved = boolFilter(toBoolean(isAdminApproved));
  }
  // Only the live attempt by default — superseded rows are history, not work.
  match.isSuperseded = boolFilter(
    isSuperseded === undefined ? false : toBoolean(isSuperseded),
  );

  if (minScore !== undefined || maxScore !== undefined) {
    match.score = {};
    if (minScore !== undefined) match.score.$gte = Number(minScore);
    if (maxScore !== undefined) match.score.$lte = Number(maxScore);
  }

  if (fromDate || toDate) {
    match.createdAt = {};
    if (fromDate) match.createdAt.$gte = new Date(fromDate);
    if (toDate) {
      const till = new Date(toDate);
      till.setHours(23, 59, 59, 999);
      match.createdAt.$lte = till;
    }
  }

  const direction = sortOrder === BRAND_VERIFICATION_SORT_ORDER.ASC ? 1 : -1;
  let sortStage = { createdAt: -1, _id: -1 };
  if (sortBy === BRAND_VERIFICATION_SORT_BY.SCORE) {
    sortStage = { score: direction, createdAt: -1 };
  } else if (sortBy === BRAND_VERIFICATION_SORT_BY.OLDEST) {
    sortStage = { createdAt: 1, _id: 1 };
  } else if (sortBy === BRAND_VERIFICATION_SORT_BY.NEWEST) {
    sortStage = { createdAt: -1, _id: -1 };
  }

  const pipeline = [
    { $match: match },

    // ---------------------------------------------------------------
    // BRAND (+ its vendor)
    // ---------------------------------------------------------------
    ...buildAggregateLookup({
      from: "brands",
      localField: "brandId",
      as: "brand",
      project: {
        brandName: 1,
        legalBusinessName: 1,
        uniqueId: 1,
        merchantId: 1,
        logo: 1,
        email: 1,
        mobile: 1,
        whatsappNumber: 1,
        businessEntityType: 1,
        businessRegistrationStatus: 1,
        status: 1,
        verificationAttemptCount: 1,
        isApproved: 1,
        isReviewed: 1,
        isRejected: 1,
        userId: 1,
      },
    }),
    ...buildAggregateLookup({
      from: "users",
      localField: "brand.userId",
      as: "vendor",
      project: {
        name: 1,
        email: 1,
        mobile: 1,
        role: 1,
        currentScreen: 1,
      },
    }),

    // ---------------------------------------------------------------
    // ADMINS INVOLVED
    // ---------------------------------------------------------------
    ...buildAggregateLookup({
      from: "users",
      localField: "reviewedByAdminId",
      as: "reviewedByAdmin",
      project: { name: 1, email: 1, role: 1 },
    }),
    ...buildAggregateLookup({
      from: "users",
      localField: "verifiedByAdminId",
      as: "verifiedByAdmin",
      project: { name: 1, email: 1, role: 1 },
    }),
    ...buildAggregateLookup({
      from: "users",
      localField: "rejectedByAdminId",
      as: "rejectedByAdmin",
      project: { name: 1, email: 1, role: 1 },
    }),
    ...buildAggregateLookup({
      from: "users",
      localField: "revokedByAdminId",
      as: "revokedByAdmin",
      project: { name: 1, email: 1, role: 1 },
    }),

    // ---------------------------------------------------------------
    // HOW MANY TIMES THIS BRAND HAS BEEN ACTIONED SO FAR
    // ---------------------------------------------------------------
    {
      $lookup: {
        from: "brandverificationhistories",
        let: { brandId: "$brandId" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$brandId", "$$brandId"] },
              isDeleted: false,
            },
          },
          { $group: { _id: "$action", count: { $sum: 1 } } },
        ],
        as: "historyCounts",
      },
    },
    {
      $addFields: {
        rejectionCount: countOf(BRAND_VERIFICATION_ACTION.REJECTED),
        revocationCount: countOf(BRAND_VERIFICATION_ACTION.REVOKED),
        submissionCount: countOf(BRAND_VERIFICATION_ACTION.RESUBMITTED, 1),
      },
    },

    ...(search
      ? [
          {
            $match: {
              $or: [
                { "brand.brandName": { $regex: new RegExp(search, "i") } },
                {
                  "brand.legalBusinessName": {
                    $regex: new RegExp(search, "i"),
                  },
                },
                { "brand.uniqueId": { $regex: new RegExp(search, "i") } },
                { "brand.merchantId": { $regex: new RegExp(search, "i") } },
                { remarks: { $regex: new RegExp(search, "i") } },
              ],
            },
          },
        ]
      : []),

    { $sort: sortStage },
    { $project: { __v: 0, historyCounts: 0, "brand.userId": 0 } },
  ];

  return pagination(SystemVerify, pipeline, page, limit, "brand verification");
};
