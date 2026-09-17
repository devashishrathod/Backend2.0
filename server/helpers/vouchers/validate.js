const { throwError } = require("../../utils");
const { normalizedNameKey } = require("../common");
// ⚠️ Straight from the module, not through `./index` — the barrel requires this
// file, so going back through it would be a cycle.
const { assertVoucherImageFloor } = require("./assertImageFloor");
const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");
const Category = require("../../models/Category");
const SubCategory = require("../../models/SubCategory");
const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherSubBrand = require("../../models/VoucherSubBrand");
const { VOUCHER_STATUSES } = require("../../constants/voucher");
const {
  validateVoucherOffers,
  normalizeVoucherOffers,
} = require("../voucherOffers");

exports.removeDuplicateObjectIds = (ids = []) => {
  return [...new Set(ids.map((id) => String(id)))];
};

/**
 * The comparison key behind `{ brandId, normalizedName }`, which is a **unique
 * index** — so it has to be lowercase.
 *
 * 🔴 The voucher's own `name` is stored exactly as the vendor typed it, and
 * that is what the customer app renders. This is the other half: a key nobody
 * sees, whose only job is to make "Pizza" and "pizza" the same voucher. Without
 * the lowercase the index compares bytes, and both get created.
 */
exports.normalizeVoucherName = (name) => normalizedNameKey(name);

exports.getUniqueTags = (tags = []) => {
  if (!Array.isArray(tags)) return [];
  const uniqueTags = new Map();
  tags.forEach((tag) => {
    if (typeof tag !== "string") return;
    const trimmedTag = tag.trim();
    if (!trimmedTag) return;
    const key = trimmedTag;
    if (!uniqueTags.has(key)) {
      uniqueTags.set(key, trimmedTag);
    }
  });
  return [...uniqueTags.values()];
};

exports.validateVoucherCategory = async (categoryId, session) => {
  if (!categoryId) return null;
  const category = await Category.findOne({
    _id: categoryId,
    isDeleted: false,
    isActive: true,
  })
    .session(session)
    .select("_id");

  if (!category) throwError(404, "Category not found.");
  return category;
};

exports.validateVoucherSubCategory = async (
  subCategoryId,
  categoryId,
  session,
) => {
  if (!subCategoryId) return null;
  const query = {
    _id: subCategoryId,
    isDeleted: false,
    isActive: true,
  };
  if (categoryId) query.categoryId = categoryId;
  const subCategory = await SubCategory.findOne(query)
    .session(session)
    .select("_id categoryId");

  if (!subCategory) {
    throwError(400, "Invalid subCategory for selected category.");
  }
  return subCategory;
};

exports.validateVoucherSubBrands = async (subBrandIds, brandId, session) => {
  if (!Array.isArray(subBrandIds)) subBrandIds = [subBrandIds];

  const uniqueIds = exports.removeDuplicateObjectIds(subBrandIds);
  if (!uniqueIds.length) throwError(400, "At least one SubBrand is required.");

  const subBrands = await SubBrand.find({
    _id: {
      $in: uniqueIds,
    },
    brandId,
    isDeleted: false,
    isActive: true,
  })
    .session(session)
    .select("_id brandId locationId geo storeId");

  if (subBrands.length !== uniqueIds.length) {
    throwError(
      400,
      "One or more SubBrands are invalid or do not belong to this brand.",
    );
  }

  /**
   * ⚠️ An outlet with no position cannot carry a voucher, and it has to be said
   * out loud here.
   *
   * The customer's voucher listing starts with `$geoNear` over `SubBrand.geo`.
   * An outlet with no coordinates matches nothing, so **every voucher attached
   * to it is invisible to every customer** — while the vendor sees it created,
   * approved and published exactly like any other. Nothing errors and nothing
   * is logged; the voucher simply never appears.
   *
   * This was not merely possible, it was the default: `geo.coordinates` used to
   * default to `[0, 0]` and `signUpSubBrandWithWhatsapp` never sets it, so a
   * new outlet began life at a point in the Gulf of Guinea and stayed there
   * until somebody added an address. The default is gone; this is the message
   * that replaces the silence.
   */
  const withoutPosition = subBrands.filter(
    (subBrand) => !Array.isArray(subBrand.geo?.coordinates),
  );
  if (withoutPosition.length) {
    throwError(
      400,
      withoutPosition.length === 1
        ? "One of the selected outlets has no address yet. Add its address first — a voucher on an outlet with no location is never shown to customers."
        : `${withoutPosition.length} of the selected outlets have no address yet. Add their addresses first — a voucher on an outlet with no location is never shown to customers.`,
    );
  }

  return subBrands;
};

exports.validateVoucherValidityPeriod = (validFrom, validTill) => {
  const from = new Date(validFrom);
  const till = new Date(validTill);
  if (Number.isNaN(from.getTime()) || Number.isNaN(till.getTime())) {
    throwError(400, "Invalid voucher validity date/time.");
  }
  if (from >= till) {
    throwError(400, "Voucher start date/time must be before expiry date/time.");
  }
  return { startAt: from, endAt: till };
};

exports.validateVoucherDates = (startAt, endAt, options = {}) => {
  const { requireFuture = true } = options;
  if (!startAt || !endAt)
    throwError(400, "Voucher start date and end date are required.");
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throwError(400, "Invalid voucher validity dates.");
  }
  if (end <= start) {
    throwError(400, "Voucher end date/time must be after start date/time.");
  }
  if (requireFuture && start <= new Date()) {
    throwError(400, "Voucher start date/time must be in the future.");
  }
  if (end <= new Date()) {
    throwError(400, "Voucher end date/time must be in the future.");
  }
  return { startAt: start, endAt: end };
};

exports.validateVoucherBeforeSubmit = async (
  voucher,
  version,
  { maxOffers, maxImages, minImages },
  session,
) => {
  if (
    voucher.status !== VOUCHER_STATUSES.DRAFT &&
    voucher.status !== VOUCHER_STATUSES.REJECTED
  ) {
    throwError(
      400,
      `Voucher cannot be submitted from ${voucher.status} status.`,
    );
  }

  if (
    version.status !== VOUCHER_STATUSES.DRAFT &&
    version.status !== VOUCHER_STATUSES.REJECTED
  ) {
    throwError(
      400,
      `Voucher version cannot be submitted from ${version.status} status.`,
    );
  }

  if (!version.name || !version.name.trim()) {
    throwError(400, "Voucher name is required.");
  }

  const { startAt, endAt } = exports.validateVoucherValidityPeriod(
    version.startAt,
    version.endAt,
  );
  const now = new Date();
  if (startAt <= now) {
    throwError(400, "Voucher start date/time must be in the future.");
  }

  let offers = version.offers;
  validateVoucherOffers(offers, maxOffers);
  const sortedOffers = normalizeVoucherOffers(offers);

  const imageCount = version.images.length;
  if (imageCount > maxImages) {
    throwError(400, `Maximum ${maxImages} voucher images are allowed.`);
  }
  /**
   * The last gate before a voucher goes to an admin, and the one that matters
   * most: create and the image edit each see one request, but a voucher can
   * reach here having been built across several.
   *
   * ⚠️ This line used to read `if (imageCount === 0) throwError(400, "At least
   * one image is required")` — a third wording, a second status code, and
   * blind to `minImages` entirely, so a platform configured for three would
   * happily send a one-image voucher to review.
   */
  await assertVoucherImageFloor(imageCount, { minImages });

  /**
   * 🔴 V-2 — a banner is required to submit, and **not** to publish.
   *
   * This is the one moment a vendor is deliberately handing their voucher over,
   * so it is where "you have not given us a banner" is useful rather than
   * obstructive. `current` counts as much as `pending`: a voucher whose banner
   * is already approved does not have to send it again.
   *
   * ⚠️ Publishing is deliberately **not** gated on this. A banner can be
   * rejected after submission, and blocking publish on that would take a
   * finished, approved voucher hostage to a decision about its artwork — the
   * `images[0]` fallback exists precisely so it does not have to.
   */
  const hasBanner = Boolean(
    voucher.banner?.current?.url || voucher.banner?.pending?.url,
  );
  if (!hasBanner) {
    throwError(
      422,
      'A voucher needs a banner before it can be submitted. Upload one as "media" on the banner endpoint.',
    );
  }

  const subBrandCount = await VoucherSubBrand.countDocuments({
    voucherVersionId: version._id,
    isActive: true,
    isDeleted: false,
  }).session(session);

  if (subBrandCount === 0) {
    throwError(400, "At least one SubBrand must be linked with the voucher.");
  }

  return {
    startAt,
    endAt,
    offers: sortedOffers,
    imageCount,
    subBrandCount,
  };
};

exports.validateVoucherForApproval = async (
  voucher,
  version,
  { maxOffers, maxImages },
  session,
) => {
  if (voucher.status !== VOUCHER_STATUSES.UNDER_REVIEW) {
    throwError(
      400,
      `Voucher cannot be approved from ${voucher.status} status.`,
    );
  }

  if (version.status !== VOUCHER_STATUSES.UNDER_REVIEW) {
    throwError(
      400,
      `Voucher version cannot be approved from ${version.status} status.`,
    );
  }

  if (!version.name || !version.name.trim()) {
    throwError(400, "Voucher name is required.");
  }

  const { startAt, endAt } = exports.validateVoucherValidityPeriod(
    version.startAt,
    version.endAt,
  );

  const now = new Date();

  if (startAt <= now) {
    throwError(400, "Voucher start date/time must be in the future.");
  }

  if (endAt <= startAt) {
    throwError(400, "Voucher end date/time must be after start date/time.");
  }

  let offers = Array.isArray(version.offers) ? version.offers : [];
  validateVoucherOffers(offers, maxOffers);
  const sortedOffers = normalizeVoucherOffers(offers);

  const imageCount = Array.isArray(version.images) ? version.images.length : 0;
  /**
   * ⚠️ The **structural** floor, not the configurable one — and that is the
   * whole point.
   *
   * This runs when an admin approves a voucher the vendor already submitted. If
   * it read `minImages`, an admin raising the floor between submit and approval
   * would find their queue full of vouchers they cannot approve and the vendor
   * cannot fix — a voucher retired from behind, which is exactly what
   * `minImages` is shaped to avoid (see the note on the schema field).
   *
   * The floor belongs on the way in: create, image edit, submit. By the time a
   * voucher is here it has already cleared whichever floor was live when the
   * vendor sent it, and moving that line under them afterwards is not a rule,
   * it is a trap. Zero images is different — that is corruption, not a policy
   * change.
   */
  if (imageCount === 0) {
    throwError(400, "At least one voucher image is required.");
  }

  if (imageCount > maxImages) {
    throwError(400, `Maximum ${maxImages} voucher images are allowed.`);
  }

  const subBrandCount = await VoucherSubBrand.countDocuments({
    voucherVersionId: version._id,
    isActive: true,
    isDeleted: false,
  }).session(session);

  if (subBrandCount === 0) {
    throwError(400, "At least one SubBrand must be linked with the voucher.");
  }
  return {
    startAt,
    endAt,
    offers: sortedOffers,
    imageCount,
    subBrandCount,
  };
};
