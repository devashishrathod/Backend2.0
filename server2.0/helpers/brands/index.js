const { generateUniqueBrandId } = require("./generateUniqueBrandId");
const { generateBrandMerchantId } = require("./generateBrandMerchantId");
const { validateBrandVendor } = require("./validateBrandVendor");
const {
  recordBrandVerificationHistory,
} = require("./recordBrandVerificationHistory");

module.exports = {
  generateUniqueBrandId,
  generateBrandMerchantId,
  validateBrandVendor,
  recordBrandVerificationHistory,
};
