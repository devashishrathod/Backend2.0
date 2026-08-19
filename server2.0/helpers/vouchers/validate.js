const mongoose = require("mongoose");
const { throwError } = require("../../utils");
const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");
const Category = require("../../models/Category");
const SubCategory = require("../../models/SubCategory");
const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherSubBrand = require("../../models/VoucherSubBrand");
const {
  VOUCHER_STATUSES,
  VOUCHER_OFFER_LIMITS,
} = require("../../constants/voucher");
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
  maxOffers,
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
  if (imageCount > VOUCHER_OFFER_LIMITS.MAX_IMAGES) {
    throwError(400, "Maximum 5 voucher images are allowed.");
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
  maxOffers,
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

  if (imageCount > VOUCHER_OFFER_LIMITS.MAX_IMAGES) {
    throwError(
      400,
      `Maximum ${VOUCHER_OFFER_LIMITS.MAX_IMAGES} voucher images are allowed.`,
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

//////////////////////
// const mongoose = require("mongoose");
// const { throwError } = require("../../utils");

// const { VOUCHER_STATUSES } = require("../../constants/voucher");

// exports.validateObjectId = (id, message = "Invalid ID.") => {
//   if (!mongoose.Types.ObjectId.isValid(id)) {
//     throwError(400, message);
//   }
// };

// exports.validateVoucherOwnership = (userId, voucher) => {
//   if (!voucher) {
//     throwError(404, "Voucher not found.");
//   }

//   if (String(voucher.createdBy) !== String(userId)) {
//     throwError(403, "You are not authorized to manage this voucher.");
//   }
// };

// exports.ensureEditableVersion = (version) => {
//   if (!version) {
//     throwError(404, "Voucher version not found.");
//   }

//   if (version.isDeleted) {
//     throwError(404, "Voucher version not found.");
//   }

//   if (version.isImmutable) {
//     throwError(
//       409,
//       "This voucher version is immutable and cannot be modified.",
//     );
//   }

//   if (version.status === VOUCHER_STATUSES.UNDER_REVIEW) {
//     throwError(409, "Voucher is currently under review and cannot be edited.");
//   }

//   if (version.status === VOUCHER_STATUSES.PUBLISHED) {
//     throwError(409, "Published voucher version cannot be edited.");
//   }

//   if (version.status === VOUCHER_STATUSES.ARCHIVED) {
//     throwError(409, "Archived voucher version cannot be edited.");
//   }
// };

// exports.isPublishedVersion = (version) => {
//   return (
//     version?.status === VOUCHER_STATUSES.PUBLISHED ||
//     version?.isImmutable === true
//   );
// };

/////////////////////////////////////////

// const { throwError } = require("../../utils");

// const {
//   VOUCHER_STATUSES,
//   VOUCHER_OFFER_LIMITS,
//   VOUCHER_DISCOUNT_TYPES,
//   VOUCHER_USAGE_TYPE,
//   DISCOUNT_APPLICABLE_ON,
// } = require("../../constants/voucher");

// exports.validateVoucherOffers = (offers) => {
//   if (!Array.isArray(offers)) {
//     throwError(400, "Offers must be an array.");
//   }

//   if (offers.length === 0) {
//     throwError(400, "At least one offer is required.");
//   }

//   if (offers.length > VOUCHER_OFFER_LIMITS.MAX_OFFERS) {
//     throwError(
//       400,
//       `Maximum ${VOUCHER_OFFER_LIMITS.MAX_OFFERS} offers are allowed.`,
//     );
//   }

//   const sortOrders = new Set();

//   offers.forEach((offer, index) => {
//     if (!offer.title?.trim()) {
//       throwError(400, `Offer ${index + 1}: title is required.`);
//     }

//     if (typeof offer.minBillAmount !== "number" || offer.minBillAmount < 0.01) {
//       throwError(
//         400,
//         `Offer ${index + 1}: valid minimum bill amount is required.`,
//       );
//     }

//     if (!Object.values(VOUCHER_DISCOUNT_TYPES).includes(offer.discountType)) {
//       throwError(400, `Offer ${index + 1}: invalid discount type.`);
//     }

//     if (typeof offer.discountValue !== "number" || offer.discountValue < 0.01) {
//       throwError(400, `Offer ${index + 1}: valid discount value is required.`);
//     }

//     if (
//       offer.discountType === VOUCHER_DISCOUNT_TYPES.PERCENTAGE &&
//       offer.discountValue > 100
//     ) {
//       throwError(
//         400,
//         `Offer ${index + 1}: percentage discount cannot exceed 100.`,
//       );
//     }

//     if (
//       offer.maxDiscountAmount !== undefined &&
//       offer.maxDiscountAmount !== null &&
//       offer.maxDiscountAmount < 0
//     ) {
//       throwError(
//         400,
//         `Offer ${index + 1}: max discount amount cannot be negative.`,
//       );
//     }

//     if (
//       offer.usageType &&
//       !Object.values(VOUCHER_USAGE_TYPE).includes(offer.usageType)
//     ) {
//       throwError(400, `Offer ${index + 1}: invalid usage type.`);
//     }

//     if (
//       offer.discountApplicableOn &&
//       !Object.values(DISCOUNT_APPLICABLE_ON).includes(
//         offer.discountApplicableOn,
//       )
//     ) {
//       throwError(400, `Offer ${index + 1}: invalid discount applicable on.`);
//     }

//     if (!Number.isInteger(offer.sortOrder) || offer.sortOrder < 1) {
//       throwError(400, `Offer ${index + 1}: invalid sort order.`);
//     }

//     if (sortOrders.has(offer.sortOrder)) {
//       throwError(400, "Offer sortOrder must be unique.");
//     }

//     sortOrders.add(offer.sortOrder);
//   });

//   return true;
// };

// exports.normalizeVoucherOffers = (offers) => {
//   return offers
//     .map((offer) => ({
//       title: String(offer.title).trim(),

//       minBillAmount: Number(offer.minBillAmount),

//       discountType: offer.discountType,

//       discountValue: Number(offer.discountValue),

//       maxDiscountAmount:
//         offer.maxDiscountAmount !== undefined &&
//         offer.maxDiscountAmount !== null
//           ? Number(offer.maxDiscountAmount)
//           : undefined,

//       usageType: offer.usageType || VOUCHER_USAGE_TYPE.MULTIPLE,

//       discountApplicableOn:
//         offer.discountApplicableOn || DISCOUNT_APPLICABLE_ON.SUBTOTAL,

//       sortOrder: Number(offer.sortOrder),

//       isActive: true,
//       isDeleted: false,
//     }))
//     .sort((a, b) => a.sortOrder - b.sortOrder);
// };

// exports.validateVoucherBeforeReview = async (voucher, version, session) => {
//   if (!voucher) {
//     throwError(404, "Voucher not found.");
//   }

//   if (!version) {
//     throwError(404, "Voucher version not found.");
//   }

//   if (
//     ![VOUCHER_STATUSES.DRAFT, VOUCHER_STATUSES.REJECTED].includes(
//       version.status,
//     )
//   ) {
//     throwError(
//       409,
//       `Voucher version cannot be submitted from ${version.status} status.`,
//     );
//   }

//   if (!version.name || !version.name.trim()) {
//     throwError(400, "Voucher name is required.");
//   }

//   if (!version.categoryId) {
//     throwError(400, "Voucher category is required.");
//   }

//   if (!version.subCategoryId) {
//     throwError(400, "Voucher sub-category is required.");
//   }

//   const dates = exports.validateVoucherDates(version.startAt, version.endAt, {
//     requireFuture: true,
//   });

//   /**
//    * Images
//    */

//   if (!Array.isArray(version.images) || version.images.length === 0) {
//     throwError(400, "At least one voucher image is required.");
//   }

//   if (version.images.length > VOUCHER_OFFER_LIMITS.MAX_IMAGES) {
//     throwError(
//       400,
//       `Maximum ${VOUCHER_OFFER_LIMITS.MAX_IMAGES} voucher images are allowed.`,
//     );
//   }

//   /**
//    * Offers
//    */

//   exports.validateVoucherOffers(version.offers);

//   const offers = exports.normalizeVoucherOffers(version.offers);

//   /**
//    * SubBrands
//    */

//   const VoucherSubBrand = require("../../models/VoucherSubBrand");

//   const subBrandCount = await VoucherSubBrand.countDocuments({
//     voucherId: voucher._id,
//     voucherVersionId: version._id,
//     isActive: true,
//     isDeleted: false,
//   }).session(session);

//   if (subBrandCount === 0) {
//     throwError(400, "At least one SubBrand must be linked with the voucher.");
//   }

//   return {
//     startAt: dates.startAt,
//     endAt: dates.endAt,
//     offers,
//     imageCount: version.images.length,
//     subBrandCount,
//   };
// };
