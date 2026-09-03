const { generateUniqueBrandId } = require("./generateUniqueBrandId");
const { generateBrandMerchantId } = require("./generateBrandMerchantId");
const { validateBrandVendor } = require("./validateBrandVendor");
const {
  recordBrandVerificationHistory,
} = require("./recordBrandVerificationHistory");
const { recordBrandStatusHistory } = require("./recordBrandStatusHistory");
const {
  resolveOnboardingEditWindow,
  assertOnboardingEditable,
  isRemediation,
} = require("./onboardingEditWindow");
const { recordRemediationUpdate } = require("./recordRemediationUpdate");
const { applyPlanEntitlements } = require("./applyPlanEntitlements");
const { resolveActorBrand } = require("./resolveActorBrand");
const { assertPublicBrand } = require("./assertPublicBrand");
const { recountBrandUsage } = require("./recountBrandUsage");
const { summarizeUsage } = require("./summarizeUsage");
const {
  reserveSlot,
  releaseSlot,
  switchSlot,
  bucketLabel,
} = require("./entitlementSlots");
const {
  resolveBrandIdentity,
  BRAND_IDENTITY_FALLBACK_NAME,
} = require("./resolveBrandIdentity");

module.exports = {
  resolveActorBrand,
  resolveBrandIdentity,
  BRAND_IDENTITY_FALLBACK_NAME,
  assertPublicBrand,
  generateUniqueBrandId,
  generateBrandMerchantId,
  validateBrandVendor,
  recordBrandVerificationHistory,
  recordBrandStatusHistory,
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
