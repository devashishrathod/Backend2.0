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
const { applyPlanEntitlements } = require("./applyPlanEntitlements");
const { resolveActorBrand } = require("./resolveActorBrand");
const { recountBrandUsage } = require("./recountBrandUsage");
const { summarizeUsage } = require("./summarizeUsage");
const {
  reserveSlot,
  releaseSlot,
  switchSlot,
  bucketLabel,
} = require("./entitlementSlots");

module.exports = {
  resolveActorBrand,
  generateUniqueBrandId,
  generateBrandMerchantId,
  validateBrandVendor,
  recordBrandVerificationHistory,
  resolveOnboardingEditWindow,
  assertOnboardingEditable,
  isRemediation,
  recordRemediationUpdate,
  applyPlanEntitlements,
  recountBrandUsage,
  summarizeUsage,
  reserveSlot,
  releaseSlot,
  switchSlot,
  bucketLabel,
};
