const mongoose = require("mongoose");
const SubBrand = require("../../models/SubBrand");
const { buildAggregateLookup } = require("../../database");
const { ROLES } = require("../../constants");
const { resolveActorBrand } = require("../../helpers/brands");
const { escapeRegex } = require("../../validator/common");
const { pagination, validateObjectId, throwError } = require("../../utils");

/**
 * A case-insensitive "contains", from text a caller typed.
 *
 * ⚠️ `escapeRegex` is the whole point. Eleven places here built a `RegExp` straight
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
 * Restrict the listing to what this caller is entitled to see.
 *
 * ⚠️ There was no such restriction. The route's gate establishes that the caller
 * is *a* vendor — nothing established **which** brand — and every filter below
 * is optional, so one request with no `brandId` returned every outlet on the
 * platform: each one's address, manager email, mobile and store id, a page at a
 * time until there were none left. Naming somebody else's `brandId` returned
 * their outlets just as readily.
 *
 * Same shape as `getAllLocations`, deliberately — it is the same bug.
 */
const scopeToActor = async (actor, match, requestedBrandId) => {
  if (actor?.role === ROLES.ADMIN) return match;

  if (actor?.role === ROLES.VENDOR) {
    /**
     * Resolved from `Brand.userId`, not from the token's cached `brandId`, so a
     * stale token cannot widen what it reaches — and a vendor who names another
     * brand is refused here rather than quietly handed their own rows, which
     * would read as the filter being ignored.
     */
    const brand = await resolveActorBrand(actor, requestedBrandId);
    match.brandId = brand._id;
    return match;
  }

  /**
   * An outlet manager sees their own outlet and nothing else.
   *
   * ⚠️ Scoped on `_id`, not on the brand. `authenticate` copies the brand onto a
   * sub-vendor's token so brand-wide reads work elsewhere, so scoping on
   * `brandId` here would hand them every sibling outlet — including each
   * manager's contact details.
   */
  if (actor?.role === ROLES.SUB_VENDOR) {
    if (!actor.subBrandId) {
      throwError(404, "No outlet is linked to your account");
    }
    match._id = new mongoose.Types.ObjectId(String(actor.subBrandId));
    delete match.brandId;
    return match;
  }

  throwError(403, "Forbidden: You do not have permission to perform this action.");
};

/**
 * @param {{ userId: string, role: string, brandId?: string, subBrandId?: string }} actor
 * @param {object} query
 */
exports.getAllSubBrands = async (actor, query) => {
  let {
    page,
    limit,
    search,
    userId,
    brandId,
    locationId,
    workHoursId,
    outletType,
    email,
    mobile,
    whatsappNumber,
    uniqueId,
    storeId,
    isActive,
    fromDate,
    toDate,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 10;

  const match = { isDeleted: false };

  if (userId) {
    validateObjectId(userId, "User Id");
    match.userId = new mongoose.Types.ObjectId(userId);
  }
  // Validated here so a malformed id is a 422 rather than reaching the scope
  // resolver as a lookup that finds nothing.
  if (brandId) validateObjectId(brandId, "Brand Id");
  if (locationId) {
    validateObjectId(locationId, "Location Id");
    match.locationId = new mongoose.Types.ObjectId(locationId);
  }
  if (workHoursId) {
    validateObjectId(workHoursId, "Work Hours Id");
    match.workHoursId = new mongoose.Types.ObjectId(workHoursId);
  }
  if (outletType) match.outletType = outletType;
  if (isActive !== undefined) {
    match.isActive = isActive === "true" || isActive === true;
  }
  if (email) match.email = contains(email);
  if (mobile) match.mobile = contains(mobile);
  if (whatsappNumber) {
    match.whatsappNumber = contains(whatsappNumber);
  }
  if (uniqueId) match.uniqueId = contains(uniqueId);
  if (storeId) match.storeId = contains(storeId);

  if (search) {
    match.$or = [
      { email: contains(search) },
      { mobile: contains(search) },
      { whatsappNumber: contains(search) },
      { uniqueId: contains(search) },
      { storeId: contains(search) },
      { description: contains(search) },
    ];
  }

  if (fromDate || toDate) {
    match.joinedDate = {};
    if (fromDate) match.joinedDate.$gte = new Date(fromDate);
    if (toDate) {
      const d = new Date(toDate);
      d.setHours(23, 59, 59, 999);
      match.joinedDate.$lte = d;
    }
  }

  /**
   * ⚠️ Last, and after every caller-supplied filter — so nothing above can widen
   * what this returns. `brandId` from the query is a *request*, not a decision:
   * the resolver either confirms it belongs to this caller or refuses.
   */
  await scopeToActor(actor, match, brandId);

  const sortStage = {};
  sortStage[sortBy] = sortOrder === "asc" ? 1 : -1;

  const pipeline = [
    { $match: match },
    { $sort: sortStage },

    // =========================================================
    // SUB BRAND LOCATION
    // =========================================================
    ...buildAggregateLookup({
      from: "locations",
      localField: "locationId",
      as: "location",
    }),

    // =========================================================
    // SUB BRAND WORK HOURS
    // =========================================================
    ...buildAggregateLookup({
      from: "workhours",
      localField: "workHoursId",
      as: "workHours",
    }),

    { $project: { __v: 0 } },
  ];

  return await pagination(SubBrand, pipeline, page, limit);
};
