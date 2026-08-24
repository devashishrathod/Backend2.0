const {
  recordBrandVerificationHistory,
} = require("./recordBrandVerificationHistory");
const {
  BRAND_VERIFICATION_ACTION,
  BRAND_VERIFICATION_ACTOR,
} = require("../../constants/brandVerification");

/**
 * Logs one onboarding section the vendor edited while fixing a rejection.
 *
 * Keeps the trail answering "what did the vendor change, and when" between a
 * rejection and the next system-verify attempt. The attempt's own status is
 * unchanged by an edit, so previousStatus and newStatus are the same.
 *
 * Never stores the document number itself — only whether it changed.
 *
 * @param {Object} params
 * @param {Object} params.brand         Brand document.
 * @param {Object} params.systemVerify  The live (rejected) attempt.
 * @param {String} params.userId        Vendor performing the edit.
 * @param {String} params.section       BRAND_ONBOARDING_SECTION value.
 * @param {String} [params.changeType]  BRAND_ONBOARDING_CHANGE_TYPE value.
 * @param {Object} [params.details]     Extra non-sensitive context.
 */
exports.recordRemediationUpdate = async ({
  brand,
  systemVerify,
  userId,
  section,
  changeType = null,
  details = null,
}) => {
  if (!systemVerify) return null;
  return recordBrandVerificationHistory({
    brandId: brand._id,
    systemVerifyId: systemVerify._id,
    action: BRAND_VERIFICATION_ACTION.REMEDIATION_UPDATED,
    performedByType: BRAND_VERIFICATION_ACTOR.VENDOR,
    performedBy: userId,
    attemptNumber: systemVerify.attemptNumber || 1,
    brandUniqueId: brand.uniqueId,
    merchantId: brand.merchantId,
    previousStatus: systemVerify.status,
    newStatus: systemVerify.status,
    metadata: {
      section,
      ...(changeType ? { changeType } : {}),
      ...(details ? { details } : {}),
    },
  });
};
