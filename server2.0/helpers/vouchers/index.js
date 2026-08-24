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
  uploadVoucherBannerMedia,
  deleteVoucherBannerMedia,
};
