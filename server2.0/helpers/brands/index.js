const { generateUniqueBrandId } = require("./generateUniqueBrandId");
const { generateBrandMerchantId } = require("./generateBrandMerchantId");
const { validateBrandVendor } = require("./validateBrandVendor");
const {
  recordBrandVerificationHistory,
} = require("./recordBrandVerificationHistory");
const {
  resolveOnboardingEditWindow,
  assertOnboardingEditable,
  isRemediation,
} = require("./onboardingEditWindow");
const { recordRemediationUpdate } = require("./recordRemediationUpdate");

module.exports = {
  generateUniqueBrandId,
  generateBrandMerchantId,
  validateBrandVendor,
  recordBrandVerificationHistory,
  resolveOnboardingEditWindow,
  assertOnboardingEditable,
  isRemediation,
  recordRemediationUpdate,
};
