const mongoose = require("mongoose");
const VoucherVersion = require("../../models/VoucherVersion");
const SubBrand = require("../../models/SubBrand");
const { buildAggregateLookup } = require("../../database");
const { ROLES } = require("../../constants");
const { resolveActorBrand } = require("../../helpers/brands");
const { escapeRegex } = require("../../validator/common");
const { pagination, validateObjectId, throwError } = require("../../utils");
const { VOUCHER_SORT_BY } = require("../../constants/voucher");


/**
 * A case-insensitive "contains", from text a caller typed.
 *
 * ⚠️ `escapeRegex` is the whole point. Six places here built a `RegExp` straight
 * from the query string, which hands a caller the regex engine:
 *
 *   - `search=[` is not a pattern at all — `new RegExp` throws `SyntaxError`
 *     before Mongo is reached, so a stray bracket in a search box is a 500
 *   - `search=.*` matches every row, quietly turning a filter into no filter
 *   - `search=(a+)+$` is catastrophic backtracking. The expression is evaluated
 *     by **Mongo**, not here — building the query object costs nothing — but it
 *     is then run against every document the query scans
 *
 * Same helper, same reasoning as `getAllLocations`.
 */
const contains = (text) => ({ $regex: new RegExp(escapeRegex(text), "i") });

/**
 * Restrict the listing to the brand this caller may actually read.
 *
 * ⚠️ There was no restriction. The route gate says the caller is *a* vendor;
 * nothing said **which** brand — and `brandId` was an optional filter, so one
 * request without it returned every voucher version on the platform, including
 * other brands' unpublished drafts, their pricing and their rejection notes.
 *
 * Same shape as `getAllLocations` and `getAllSubBrands`: it is the same bug.
 */
const scopeToActor = async (actor, match, requestedBrandId) => {
  if (actor?.role === ROLES.ADMIN) return match;

  if (actor?.role === ROLES.VENDOR) {
    const brand = await resolveActorBrand(actor, requestedBrandId);
    match.brandId = brand._id;
    return match;
  }

  /**
   * A sub-vendor sees the brand's vouchers, not a narrower slice: a voucher
   * belongs to the brand and is redeemed at every outlet, so an outlet-level
   * cut would hide the very vouchers that counter accepts.
   *
   * ⚠️ **Not through `resolveActorBrand`.** That helper compares
   * `brand.userId === actor.userId`, and an outlet manager's user id is never
   * the one on the brand — so it answers 403 for a sub-vendor asking about
   * their own brand. The brand is read off their outlet instead.
   *
   * ⚠️ And off the **outlet row**, not the token. `authenticate` copies a brand
   * onto a sub-vendor's token; trusting that would let a stale or edited claim
   * choose the brand.
   */
  if (actor?.role === ROLES.SUB_VENDOR) {
    if (!actor.subBrandId) {
      throwError(404, "No outlet is linked to your account");
    }
    const outlet = await SubBrand.findOne({
      _id: actor.subBrandId,
      isDeleted: false,
    })
      .select("brandId")
      .lean();
    if (!outlet) throwError(404, "No outlet is linked to your account");

    if (
      requestedBrandId &&
      String(requestedBrandId) !== String(outlet.brandId)
    ) {
      throwError(
        403,
        "Forbidden: You do not have permission to perform this action on this brand.",
      );
    }

    match.brandId = outlet.brandId;
    return match;
  }

  throwError(403, "Forbidden: You do not have permission to perform this action.");
};

exports.getAllVoucherVersions = async (actor, query) => {
  let {
    page,
    limit,
    search,
    voucherId,
    brandId,
    categoryId,
    subCategoryId,
    createdBy,
    submittedBy,
    reviewedBy,
    approvedBy,
    rejectedBy,
    versionNumber,
    name,
    versionCode,
    status,
    isImmutable,
    isActive,
    fromDate,
    toDate,
    sortBy,
    sortOrder,
  } = query;

  // RELEVANCE only makes sense with an actual search term to score against;
  // without one, treat it as NEWEST.
  const useRelevance = sortBy === VOUCHER_SORT_BY.RELEVANCE && !!search;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 10;

  const match = { isDeleted: false };

  if (voucherId) {
    validateObjectId(voucherId, "Voucher Id");
    match.voucherId = new mongoose.Types.ObjectId(voucherId);
  }
  // Validated here so a malformed id is a 422 rather than reaching the scope
  // resolver as a lookup that finds nothing.
  if (brandId) validateObjectId(brandId, "Brand Id");
  if (categoryId) {
    validateObjectId(categoryId, "Category Id");
    match.categoryId = new mongoose.Types.ObjectId(categoryId);
  }
  if (subCategoryId) {
    validateObjectId(subCategoryId, "Sub Category Id");
    match.subCategoryId = new mongoose.Types.ObjectId(subCategoryId);
  }
  if (createdBy) {
    validateObjectId(createdBy, "Created By Id");
    match.createdBy = new mongoose.Types.ObjectId(createdBy);
  }
  if (submittedBy) {
    validateObjectId(submittedBy, "Submitted By Id");
    match.submittedBy = new mongoose.Types.ObjectId(submittedBy);
  }
  if (reviewedBy) {
    validateObjectId(reviewedBy, "Reviewed By Id");
    match.reviewedBy = new mongoose.Types.ObjectId(reviewedBy);
  }
  if (approvedBy) {
    validateObjectId(approvedBy, "Approved By Id");
    match.approvedBy = new mongoose.Types.ObjectId(approvedBy);
  }
  if (rejectedBy) {
    validateObjectId(rejectedBy, "Rejected By Id");
    match.rejectedBy = new mongoose.Types.ObjectId(rejectedBy);
  }
  if (versionNumber) match.versionNumber = Number(versionNumber);
  if (status) match.status = status;
  if (isImmutable !== undefined) {
    match.isImmutable = isImmutable === "true" || isImmutable === true;
  }
  if (isActive !== undefined) {
    match.isActive = isActive === "true" || isActive === true;
  }
  if (name) match.name = contains(name);
  if (versionCode) {
    match.versionCode = contains(versionCode);
  }

  if (useRelevance) {
    // $text must be the first stage in the pipeline, so it's folded into
    // this same $match object rather than a separate stage.
    match.$text = { $search: search };
  } else if (search) {
    match.$or = [
      { name: contains(search) },
      { description: contains(search) },
      { versionCode: contains(search) },
      { tags: contains(search) },
    ];
  }

  if (fromDate || toDate) {
    match.createdAt = {};
    if (fromDate) match.createdAt.$gte = new Date(fromDate);
    if (toDate) {
      const d = new Date(toDate);
      d.setHours(23, 59, 59, 999);
      match.createdAt.$lte = d;
    }
  }

  /**
   * ⚠️ Last, after every caller-supplied filter, so nothing above can widen it.
   */
  await scopeToActor(actor, match, brandId);

  let sortStage;
  if (useRelevance) {
    sortStage = { score: { $meta: "textScore" } };
  } else if (
    sortBy === VOUCHER_SORT_BY.NEWEST ||
    (sortBy === VOUCHER_SORT_BY.RELEVANCE && !search) ||
    !sortBy
  ) {
    sortStage = { createdAt: sortOrder === "asc" ? 1 : -1 };
  } else if (sortBy === VOUCHER_SORT_BY.EXPIRING_SOON) {
    sortStage = { endAt: sortOrder === "desc" ? -1 : 1 };
  } else {
    // Legacy raw-field sort (admin table columns): name, versionNumber,
    // status, startAt, endAt, publishedAt, createdAt, updatedAt.
    sortStage = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
  }

  const userProject = { password: 0, otp: 0, refreshToken: 0 };

  const pipeline = [
    { $match: match },
    { $sort: sortStage },

    // =========================================================
    // VOUCHER
    // =========================================================
    ...buildAggregateLookup({
      from: "vouchers",
      localField: "voucherId",
      as: "voucher",
    }),

    // =========================================================
    // BRAND
    // =========================================================
    ...buildAggregateLookup({
      from: "brands",
      localField: "brandId",
      as: "brand",
    }),

    // =========================================================
    // CATEGORY
    // =========================================================
    ...buildAggregateLookup({
      from: "categories",
      localField: "categoryId",
      as: "category",
    }),

    // =========================================================
    // SUB CATEGORY
    // =========================================================
    ...buildAggregateLookup({
      from: "subcategories",
      localField: "subCategoryId",
      as: "subCategory",
    }),

    // =========================================================
    // CREATED BY
    // =========================================================
    ...buildAggregateLookup({
      from: "users",
      localField: "createdBy",
      as: "createdByUser",
      project: userProject,
    }),

    // =========================================================
    // SUBMITTED BY
    // =========================================================
    ...buildAggregateLookup({
      from: "users",
      localField: "submittedBy",
      as: "submittedByUser",
      project: userProject,
    }),

    // =========================================================
    // REVIEWED BY
    // =========================================================
    ...buildAggregateLookup({
      from: "users",
      localField: "reviewedBy",
      as: "reviewedByUser",
      project: userProject,
    }),

    // =========================================================
    // APPROVED BY
    // =========================================================
    ...buildAggregateLookup({
      from: "users",
      localField: "approvedBy",
      as: "approvedByUser",
      project: userProject,
    }),

    // =========================================================
    // REJECTED BY
    // =========================================================
    ...buildAggregateLookup({
      from: "users",
      localField: "rejectedBy",
      as: "rejectedByUser",
      project: userProject,
    }),

    { $project: { __v: 0 } },
  ];

  return await pagination(VoucherVersion, pipeline, page, limit);
};
