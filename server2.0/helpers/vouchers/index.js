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
// const {
//   cloneVoucherVersion,
//   createVoucherHistory,
// } = require("./validateVersions");
const {
  buildCustomerVoucherPipeline,
  buildCustomerVoucherDetailPipeline,
} = require("./customerListing");

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
  // cloneVoucherVersion,
  // createVoucherHistory,
  buildCustomerVoucherPipeline,
  buildCustomerVoucherDetailPipeline,
};
