const mongoose = require("mongoose");
const BrandVerificationHistory = require("../../models/BrandVerificationHistory");
const { buildAggregateLookup } = require("../../database");
const { pagination, validateObjectId, throwError } = require("../../utils");
const { ROLES } = require("../../constants");
const {
  BRAND_VERIFICATION_SORT_ORDER,
} = require("../../constants/brandVerification");

/**
 * Paginated verification audit trail.
 *
 * Shared by the admin panel and the vendor panel: a vendor is force-scoped to
 * its own brand and gets a trimmed projection (no score, flags or internal
 * metadata) — it still sees every rejection, when it happened and why.
 */
exports.getBrandVerificationHistory = async (query = {}, requester = {}) => {
  let {
    page,
    limit,
    brandId,
    systemVerifyId,
    action,
    performedBy,
    performedByType,
    attemptNumber,
    search,
    fromDate,
    toDate,
    sortOrder,
  } = query;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 10;

  const match = { isDeleted: false };

  // Drives the trimmed projection further down as well as the scoping here, so
  // it has to be resolved before either. It used to be declared inside the
  // scoping block that got rewritten below, which left the two reads in the
  // pipeline referencing a name that no longer existed — every vendor request
  // died with `ReferenceError: isVendor is not defined`.
  const isVendor = requester.role === ROLES.VENDOR;

  // Every role is named explicitly. The `else` used to catch admins *and*
  // everyone else, so a customer could pass any `brandId` and read that brand's
  // KYC scores, match flags, duplicate findings and rejection reasons.
  if (isVendor) {
    // A vendor can never widen the scope past its own brand.
    if (!requester.brandId) throwError(400, "Brand not found for user.");
    match.brandId = new mongoose.Types.ObjectId(requester.brandId);
  } else if (requester.role === ROLES.ADMIN) {
    // Optional for an admin: omitting it reads across every brand.
    if (brandId) {
      validateObjectId(brandId, "Brand Id");
      match.brandId = new mongoose.Types.ObjectId(brandId);
    }
  } else {
    throwError(403, "Forbidden");
  }

  if (systemVerifyId) {
    validateObjectId(systemVerifyId, "System Verify Id");
    match.systemVerifyId = new mongoose.Types.ObjectId(systemVerifyId);
  }
  if (performedBy) {
    validateObjectId(performedBy, "Performed By Id");
    match.performedBy = new mongoose.Types.ObjectId(performedBy);
  }
  if (action) match.action = action;
  if (performedByType) match.performedByType = performedByType;
  if (attemptNumber) match.attemptNumber = Number(attemptNumber);

  if (search) {
    match.$or = [
      { brandUniqueId: { $regex: new RegExp(search, "i") } },
      { merchantId: { $regex: new RegExp(search, "i") } },
      { reason: { $regex: new RegExp(search, "i") } },
    ];
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

  const pipeline = [
    { $match: match },
    { $sort: { createdAt: direction, _id: direction } },

    // ---------------------------------------------------------------
    // BRAND
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
        status: 1,
        isApproved: 1,
        isReviewed: 1,
        isRejected: 1,
      },
    }),

    // ---------------------------------------------------------------
    // WHO PERFORMED THE ACTION — admin-side only; a vendor has no business
    // knowing which admin touched its file.
    // ---------------------------------------------------------------
    ...(isVendor
      ? []
      : buildAggregateLookup({
          from: "users",
          localField: "performedBy",
          as: "performedByUser",
          project: {
            name: 1,
            email: 1,
            mobile: 1,
            role: 1,
          },
        })),

    isVendor
      ? {
          // Vendor-facing trail — the scoring internals stay admin-only.
          $project: {
            brandId: 1,
            action: 1,
            performedByType: 1,
            attemptNumber: 1,
            previousStatus: 1,
            newStatus: 1,
            reason: 1,
            createdAt: 1,
            brand: 1,
          },
        }
      : {
          $project: {
            __v: 0,
            isDeleted: 0,
          },
        },
  ];

  return pagination(
    BrandVerificationHistory,
    pipeline,
    page,
    limit,
    "brand verification history",
  );
};
