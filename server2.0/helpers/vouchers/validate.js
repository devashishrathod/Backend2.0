const mongoose = require("mongoose");
const { throwError } = require("../../utils");
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

exports.validateObjectIds = (ids, fieldName = "Ids") => {
  if (!Array.isArray(ids)) ids = [ids];
  for (const id of ids) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throwError(400, `Invalid ${fieldName} format.`);
    }
  }
  return true;
};

exports.removeDuplicateObjectIds = (ids = []) => {
  return [...new Set(ids.map((id) => String(id)))];
};

exports.normalizeVoucherName = (name) => {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
};

exports.getUniqueTags = (tags = []) => {
  if (!Array.isArray(tags)) return [];
  const uniqueTags = new Map();
  tags.forEach((tag) => {
    if (typeof tag !== "string") return;
    const trimmedTag = tag.trim();
    if (!trimmedTag) return;
    const key = trimmedTag.toLowerCase();
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
  { maxOffers, maxImages },
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
  if (imageCount === 0) throwError(400, "At least one image is required");

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
