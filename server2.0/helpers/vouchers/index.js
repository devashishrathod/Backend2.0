const {
  calculateVoucherPricing,
  computeOfferDiscount,
} = require("./calculateVoucherPricing");
const {
  buildVoucherOrderSummary,
} = require("./buildVoucherOrderSummary");
const { resolveClaimOffer } = require("./resolveClaimOffer");
const { buildClaimPreview } = require("./buildClaimPreview");
const {
  normalizeVoucherName,
  getUniqueTags,
  validateVoucherCategory,
  validateVoucherSubCategory,
  validateVoucherSubBrands,
  validateVoucherDates,
  validateVoucherValidityPeriod,
  validateVoucherBeforeSubmit,
  validateVoucherForApproval,
} = require("./validate");
const {
  normalizeVoucherImages,
  validateVoucherImages,
  uploadVoucherImages,
  rollbackVoucherImages,
} = require("./validateImagesFiles");
const {
  generateVoucherCode,
  generateVoucherVersionCode,
} = require("./generateUniueCode");
const {
  getNextVersionNumber,
  createVoucherHistory,
} = require("./validateVersions");
const {
  buildCustomerVoucherPipeline,
  buildCustomerVoucherDetailPipeline,
  mapCustomerVoucherDetail,
  mapCustomerVoucherListItem,
} = require("./customerListing");
const { pickVoucherBanner } = require("./pickVoucherBanner");
const {
  uploadVoucherBannerMedia,
  deleteVoucherBannerMedia,
} = require("./voucherBannerMedia");

module.exports = {
  normalizeVoucherName,
  getUniqueTags,
  validateVoucherCategory,
  validateVoucherSubCategory,
  validateVoucherSubBrands,
  validateVoucherDates,
  validateVoucherValidityPeriod,
  validateVoucherBeforeSubmit,
  validateVoucherForApproval,
  normalizeVoucherImages,
  validateVoucherImages,
  uploadVoucherImages,
  rollbackVoucherImages,
  generateVoucherCode,
  generateVoucherVersionCode,
  getNextVersionNumber,
  createVoucherHistory,
  buildCustomerVoucherPipeline,
  buildCustomerVoucherDetailPipeline,
  mapCustomerVoucherDetail,
  mapCustomerVoucherListItem,
  pickVoucherBanner,
  uploadVoucherBannerMedia,
  deleteVoucherBannerMedia,
  // The single source for what a claim costs. Nothing else may compute these.
  calculateVoucherPricing,
  computeOfferDiscount,
  // The rows a claim checkout renders. The client does no arithmetic.
  buildVoucherOrderSummary,
  // Which offer applies. Ranks with the same computeOfferDiscount that charges.
  resolveClaimOffer,
  // One builder for preview AND order creation, so the price shown is the price
  // charged. `strictPromo` is the only difference between the two.
  buildClaimPreview,
};
