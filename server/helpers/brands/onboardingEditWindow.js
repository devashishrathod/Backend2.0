const SystemVerify = require("../../models/SystemVerify");
const { throwError } = require("../../utils");
const { SYSTEM_VERIFICATION_STATUS } = require("../../constants");
const {
  BRAND_ONBOARDING_EDIT_MODE,
} = require("../../constants/brandOnboarding");

const LOCKED_MESSAGES = Object.freeze({
  APPROVED:
    "Your brand is already approved, so onboarding details can no longer be changed here.",
  UNDER_REVIEW:
    "Your details are locked while your application is under review. If anything needs correcting, you'll be able to edit it once we get back to you.",
});

/**
 * Decides whether a brand's pre-approval onboarding data is writable right now.
 *
 * The onboarding funnel is forward-only on the first pass, then fully reopens as
 * one block if an admin rejects or revokes — the vendor fixes whatever the
 * rejection message named on a single page and resubmits. It stays shut while an
 * admin decision is pending, which is what stops a paid PAN/GST/bank
 * verification from being spent when nothing is actionable.
 *
 * @param   {Object} brand  Brand document (needs isApproved + systemVerifyId).
 * @returns {Promise<{mode: string, systemVerify: Object|null, reason: string|null}>}
 */
exports.resolveOnboardingEditWindow = async (brand) => {
  if (brand.isApproved) {
    return {
      mode: BRAND_ONBOARDING_EDIT_MODE.LOCKED,
      systemVerify: null,
      reason: LOCKED_MESSAGES.APPROVED,
    };
  }

  // Never system-verified — the original funnel, nothing to gate.
  if (!brand.systemVerifyId) {
    return {
      mode: BRAND_ONBOARDING_EDIT_MODE.FIRST_PASS,
      systemVerify: null,
      reason: null,
    };
  }

  const systemVerify = await SystemVerify.findOne({
    _id: brand.systemVerifyId,
    isDeleted: false,
  }).select(
    "_id attemptNumber status isRejected isRevoked isAdminApproved isSuperseded rejectionReason revokeReason",
  );

  // A brand pointing at a missing or already-retired attempt is treated as a
  // first pass rather than being wedged shut.
  if (!systemVerify || systemVerify.isSuperseded) {
    return {
      mode: BRAND_ONBOARDING_EDIT_MODE.FIRST_PASS,
      systemVerify: null,
      reason: null,
    };
  }

  if (systemVerify.isAdminApproved) {
    return {
      mode: BRAND_ONBOARDING_EDIT_MODE.LOCKED,
      systemVerify,
      reason: LOCKED_MESSAGES.APPROVED,
    };
  }

  const isReopened =
    systemVerify.isRejected ||
    systemVerify.isRevoked ||
    systemVerify.status === SYSTEM_VERIFICATION_STATUS.REJECTED ||
    systemVerify.status === SYSTEM_VERIFICATION_STATUS.REVOKED;

  return isReopened
    ? {
        mode: BRAND_ONBOARDING_EDIT_MODE.REMEDIATION,
        systemVerify,
        reason: null,
      }
    : {
        mode: BRAND_ONBOARDING_EDIT_MODE.LOCKED,
        systemVerify,
        reason: LOCKED_MESSAGES.UNDER_REVIEW,
      };
};

/** Throws 409 when the window is shut. Returns the window otherwise. */
exports.assertOnboardingEditable = (editWindow) => {
  if (editWindow.mode === BRAND_ONBOARDING_EDIT_MODE.LOCKED) {
    throwError(409, editWindow.reason);
  }
  return editWindow;
};

/** True while the vendor is fixing a rejection (currentScreen must not move). */
exports.isRemediation = (editWindow) =>
  editWindow.mode === BRAND_ONBOARDING_EDIT_MODE.REMEDIATION;
