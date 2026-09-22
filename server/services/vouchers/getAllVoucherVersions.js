const mongoose = require("mongoose");
const VoucherVersion = require("../../models/VoucherVersion");
const SubBrand = require("../../models/SubBrand");
const { buildAggregateLookup } = require("../../database");
const { ROLES } = require("../../constants");
const { resolveActorBrand } = require("../../helpers/brands");
const { escapeRegex } = require("../../validator/common");
const { toMediaResponse } = require("../../helpers/media");
const { toManagedBanner } = require("../../helpers/vouchers/managedBanner");
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
 * Every file on a voucher version row, through the one admin media shape.
 *
 * ### 🔴 Why this is here and not in the `$project`
 *
 * `toMediaResponse` is the single place that decides what a stored file looks
 * like on the wire, and its admin shape is deliberate: size, dimensions, mime
 * type, original name and **`provider`** — but never `publicId`, `bucket` or
 * `key`. Those are the object's *address*, not detail about it; whoever holds
 * one can fetch or overwrite the file directly, around every check this server
 * makes.
 *
 * This endpoint had never gone through it. `formatManagedMedia` (showcase
 * panel) and `toAdminTickerShape` (tickers) both had, so the voucher panel was
 * the one surface of three answering the same question a different way — with
 * the locator still attached, and with `storage` nested where the other two
 * answer a flat `provider`.
 *
 * ⚠️ One shape across all three panels is the point. A panel that learns to
 * read a media object once should not have to learn a second spelling because
 * of which endpoint it came from.
 */
const shapeVersionMedia = (version) => {
  if (!version) return version;

  const shaped = {
    ...version,
    images: (version.images || []).map((image) => ({
      _id: image._id,
      media: toMediaResponse(image.media, { forAdmin: true }),
      sortOrder: image.sortOrder,
    })),
  };

  /**
   * ⚠️ Shaped, not dropped. The panel renders the voucher's banner, and it goes
   * through the **same** helper the upload and review responses use — so the
   * three surfaces that answer with a banner cannot describe it three ways,
   * which is exactly what they were doing.
   */
  if (version.voucher?.banner) {
    shaped.voucher = {
      ...version.voucher,
      banner: toManagedBanner(version.voucher.banner),
    };
  }

  return shaped;
};

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
    includeDeleted,
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

  /**
   * 🔴 `isDeleted: false` was hardcoded here — **for admins too** (V-6b).
   *
   * That was fine while nothing could be deleted. Now that V-6 exists, a
   * deleted voucher vanishes from the one listing that is supposed to be able
   * to answer "what happened to it": an admin handling a support ticket about a
   * voucher a vendor removed had no way to see it, its reason, or who removed
   * it. The rows carry `deletedAt`, `deletedBy` and `deleteReason` precisely so
   * somebody can read them.
   *
   * ⚠️ ADMIN only, and it stays **off by default**. Deleted rows in an ordinary
   * listing would quietly change what every existing caller sees — an admin's
   * approval queue is not the place to discover retired vouchers mixed in.
   *
   * ⚠️ A non-admin asking for it is refused rather than ignored. Silently
   * dropping the flag would answer "there are no deleted ones" to somebody who
   * asked a question we did not let them ask, which is the worse of the two
   * wrong answers.
   */
  const wantsDeleted = includeDeleted === "true" || includeDeleted === true;
  if (wantsDeleted && actor?.role !== ROLES.ADMIN) {
    throwError(
      403,
      "Only an admin can list deleted vouchers.",
    );
  }

  const match = wantsDeleted ? {} : { isDeleted: false };

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

  /**
   * 🔴 An **inclusion** list, and the difference is the whole point.
   *
   * This was `{ password: 0, otp: 0, refreshToken: 0 }` — which removes three
   * fields and ships every other one a `User` has. A voucher row needs to say
   * *who* submitted or approved it; what it was actually answering with was
   * that person's `email`, `mobile`, `whatsappNumber`, `username`,
   * `referralCode`, `notificationPreferences`, `isOnline`, `currentScreen`
   * and **`walletBalance`**.
   *
   * ⚠️ And `approvedByUser` / `reviewedByUser` are **admins**. This endpoint is
   * `isVendorOrAdmin`, so a vendor opening their own voucher list was reading
   * the contact details and wallet balance of the admin who reviewed it.
   *
   * A blacklist protects what somebody remembered to name. Everything below is
   * named, so a column added to `User` tomorrow does not reach a panel by
   * default — and the vendor doc has described this block as `{_id, name}`
   * all along.
   */
  const userProject = { _id: 1, name: 1, username: 1, role: 1 };

  /**
   * ⚠️ The brand a voucher belongs to, as a voucher row needs it — a name, an
   * id and a logo.
   *
   * The lookup had **no projection at all**, so it shipped the whole `Brand`:
   * `BankId`, `GSTId` and `PANId` (the pointers to its financial documents),
   * the owner's `email` / `mobile` / `whatsappNumber`, every admin audit field
   * (`approvedByAdminId`, `revokedByAdminId`, `revokeReason`,
   * `verificationAttemptCount`, `systemVerifyId`), every entitlement counter,
   * and `logoStorage` — a legacy sidecar still holding a Cloudinary `publicId`.
   */
  const brandProject = {
    _id: 1,
    brandName: 1,
    legalBusinessName: 1,
    uniqueId: 1,
    merchantId: 1,
    logo: 1,
    isActive: 1,
    isApproved: 1,
  };

  /**
   * The voucher master, as this listing needs it.
   *
   * ⚠️ `banner` is kept — the panel renders it — but it is a `mediaSchema`
   * value, so it leaves through `toMediaResponse` below like every other file
   * rather than being passed along with its locator attached.
   */
  const voucherProject = {
    _id: 1,
    name: 1,
    voucherCode: 1,
    status: 1,
    isActive: 1,
    isSuggested: 1,
    suggestionOrder: 1,
    currentVersionId: 1,
    publishedVersionId: 1,
    banner: 1,
    createdAt: 1,
  };

  /** Category and sub-category: what a label needs, nothing else. */
  const taxonomyProject = { _id: 1, name: 1, image: 1, isActive: 1 };

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
      project: voucherProject,
    }),

    // =========================================================
    // BRAND
    // =========================================================
    ...buildAggregateLookup({
      from: "brands",
      localField: "brandId",
      as: "brand",
      project: brandProject,
    }),

    // =========================================================
    // CATEGORY
    // =========================================================
    ...buildAggregateLookup({
      from: "categories",
      localField: "categoryId",
      as: "category",
      project: taxonomyProject,
    }),

    // =========================================================
    // SUB CATEGORY
    // =========================================================
    ...buildAggregateLookup({
      from: "subcategories",
      localField: "subCategoryId",
      as: "subCategory",
      project: taxonomyProject,
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

    /**
     * ⚠️ The version's **own** fields stay as they are, deliberately.
     *
     * Everything sensitive on this response came in through a lookup, and those
     * are whitelisted above. A voucher version itself is the thing being
     * listed — name, status, dates, offers, review notes — and enumerating it
     * here would mean the day somebody adds a field the panel needs, it
     * silently does not arrive.
     *
     * Its files are the one exception, and they are shaped in JS below rather
     * than here: `toMediaResponse` is where "what a file looks like on the wire"
     * is decided for every other surface, and a second answer written into a
     * `$project` is exactly how the two drift apart.
     */
    { $project: { __v: 0 } },
  ];

  const result = await pagination(VoucherVersion, pipeline, page, limit);
  result.data = (result.data || []).map(shapeVersionMedia);
  return result;
};
