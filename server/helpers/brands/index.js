const { generateUniqueBrandId } = require("./generateUniqueBrandId");
const { generateBrandMerchantId } = require("./generateBrandMerchantId");
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
const { outletDistanceExpression } = require("./outletDistanceExpression");
const {
  resolveBrandIdentity,
} = require("./resolveBrandIdentity");

const {
  customerVisibleBrandFilter,
  customerVisibleBrandExpr,
} = require("./customerVisibleBrand");

const {
  buildBrandRelationshipMap,
  brandRelationshipFor,
  getBrandRelationship,
} = require("./brandRelationship");

module.exports = {
  customerVisibleBrandFilter,
  customerVisibleBrandExpr,
  /**
   * `isFollowed` / `isAvoided` for the **viewer**, not for the brand.
   *
   * Every customer-facing brand surface returns the same two keys from the same
   * place, so the directory row, the search result and the profile it opens
   * cannot disagree — and a guest gets `false` rather than a missing key.
   */
  buildBrandRelationshipMap,
  brandRelationshipFor,
  getBrandRelationship,
  resolveActorBrand,
  resolveBrandIdentity,
  assertPublicBrand,
  outletDistanceExpression,
  generateUniqueBrandId,
  generateBrandMerchantId,
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
