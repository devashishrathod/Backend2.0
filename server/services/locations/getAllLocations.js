const { default: mongoose } = require("mongoose");
const Location = require("../../models/Location");
const { ROLES } = require("../../constants");
const { escapeRegex } = require("../../validator/common");
const { resolveActorBrand } = require("../../helpers/brands");
const { pagination, validateObjectId, throwError } = require("../../utils");

/**
 * A case-insensitive "contains", from text a caller typed.
 *
 * ⚠️ `escapeRegex` is the whole point. Thirteen places here built a `RegExp`
 * straight from the query string, which hands a caller the regex engine:
 *
 *   - `search=[` is not a pattern at all — `new RegExp` throws `SyntaxError`
 *     before Mongo is reached, so a stray bracket in a search box is a 500
 *   - `search=.*` matches every row, quietly turning a filter into no filter
 *   - `search=(a+)+$` is catastrophic backtracking. Measured against a
 *     29-character subject in Node's engine on this machine: **36.7 seconds**
 *     for one string, and the same expression is what Mongo is asked to run
 *     against every document it scans
 *
 * Six other services in this repo already escape — `getAllCustomerBrands`,
 * `getAllAdminCustomers`, the three showcase ones. This file was the gap.
 */
const contains = (text) => ({ $regex: new RegExp(escapeRegex(text), "i") });

/**
 * ⚠️ `formattedAddress` is deliberately in the list rather than instead of it.
 * It is built by joining the other eight, so it looks like a superset — but the
 * validator lets a caller send their own, and rows exist whose
 * `formattedAddress` does not contain their `addressLine1`.
 */
const SEARCHABLE_FIELDS = Object.freeze([
  "addressLine1",
  "addressLine2",
  "landmark",
  "city",
  "district",
  "state",
  "zipcode",
  "country",
  "formattedAddress",
]);

/**
 * Restrict the listing to what this caller is entitled to see.
 *
 * ⚠️ There was no such restriction. The route's gate establishes that the
 * caller is a vendor — nothing established *which* brand — and every filter
 * here is optional, so one request with no filters returned every address on
 * the platform: customers' home addresses and their coordinates included, a
 * page at a time until there were none left.
 *
 * A vendor's own surface is a single condition because an outlet's address
 * carries its `brandId` as well as its `subBrandId`. Without that it would take
 * a `$in` over every outlet id on each request.
 */
const scopeToActor = async (actor, match, requestedBrandId) => {
  if (actor?.role === ROLES.ADMIN) return match;

  if (actor?.role === ROLES.VENDOR) {
    /**
     * Resolved from `Brand.userId`, not from the token's cached `brandId`, so
     * an old token cannot widen what it reaches — and a vendor who names
     * somebody else's brand is refused here rather than quietly handed their
     * own rows, which would read as the filter being ignored.
     */
    const brand = await resolveActorBrand(actor, requestedBrandId);
    match.brandId = brand._id;
    return match;
  }

  /**
   * An outlet manager sees their own outlet's address and nothing else — not
   * the brand's registered address, and not a sibling outlet's.
   *
   * ⚠️ Scoped on `subBrandId`, not on the brand. `authenticate` copies the brand
   * onto a sub-vendor's token so brand-wide reads can work elsewhere, so
   * scoping on `brandId` here would quietly show them every outlet the brand
   * has.
   */
  if (actor?.role === ROLES.SUB_VENDOR) {
    if (!actor.subBrandId) {
      throwError(404, "No outlet is linked to your account");
    }
    match.subBrandId = new mongoose.Types.ObjectId(String(actor.subBrandId));
    delete match.brandId;
    return match;
  }

  throwError(
    403,
    "Forbidden: You do not have permission to perform this action.",
  );
};

/**
 * @param {{ userId: string, role: string, brandId?: string }} actor
 * @param {object} query
 */
exports.getAllLocations = async (actor, query) => {
  let {
    page,
    limit,
    search,
    addressLine1,
    addressLine2,
    landmark,
    shopOrBuildingNumber,
    userId,
    customerId,
    brandId,
    subBrandId,
    city,
    district,
    state,
    zipcode,
    country,
    isActive,
    addressType,
    isBrandAddress,
    isSubBrandAddress,
    isDefault,
    fromDate,
    toDate,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;
  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 10;
  const match = { isDeleted: false };
  if (isActive !== undefined) {
    match.isActive = isActive === "true" || isActive === true;
  }
  if (addressType) match.addressType = addressType;
  if (isBrandAddress !== undefined) match.isBrandAddress = isBrandAddress;
  if (isSubBrandAddress !== undefined) {
    match.isSubBrandAddress = isSubBrandAddress;
  }
  if (isDefault !== undefined) match.isDefault = isDefault;
  if (city) match.city = city;
  if (district) match.district = district;
  if (state) match.state = state;
  if (zipcode) match.zipcode = zipcode;
  if (country) match.country = country;
  if (userId) {
    validateObjectId(userId, "User Id");
    match.userId = new mongoose.Types.ObjectId(userId);
  }
  if (customerId) {
    validateObjectId(customerId, "Customer Id");
    match.customerId = new mongoose.Types.ObjectId(customerId);
  }
  if (brandId) {
    validateObjectId(brandId, "Brand Id");
    match.brandId = new mongoose.Types.ObjectId(brandId);
  }
  if (subBrandId) {
    validateObjectId(subBrandId, "Sub Brand Id");
    match.subBrandId = new mongoose.Types.ObjectId(subBrandId);
  }
  if (addressLine1) match.addressLine1 = contains(addressLine1);
  if (addressLine2) match.addressLine2 = contains(addressLine2);
  if (landmark) match.landmark = contains(landmark);
  if (shopOrBuildingNumber) {
    match.shopOrBuildingNumber = contains(shopOrBuildingNumber);
  }

  if (search) {
    /**
     * ⚠️ Nine fields, not one. `formattedAddress` is built from the other eight
     * and looks like it would cover them — but the validator lets a caller
     * supply their own, and rows exist where it does not contain the
     * `addressLine1` beside it. Collapsing this to one field would silently stop
     * finding those.
     *
     * Compiled once rather than nine times. The cost that matters is the scan,
     * not the compile, but building the same object nine times per request is
     * the kind of thing that reads as deliberate when it is not.
     */
    const term = contains(search);
    match.$or = SEARCHABLE_FIELDS.map((field) => ({ [field]: term }));
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
   * ⚠️ Last, so it always wins. Every filter above is optional and client
   * supplied; this one is neither, and applying it after them means no
   * combination of query parameters can widen the result.
   */
  await scopeToActor(actor, match, brandId);

  const pipeline = [{ $match: match }];
  const sortStage = {};
  sortStage[sortBy] = sortOrder === "asc" ? 1 : -1;
  pipeline.push({ $sort: sortStage });
  return await pagination(Location, pipeline, page, limit);
};
