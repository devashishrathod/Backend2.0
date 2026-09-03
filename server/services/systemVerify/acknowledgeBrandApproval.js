const mongoose = require("mongoose");
const User = require("../../models/User");
const Brand = require("../../models/Brand");
const { recordBrandVerificationHistory } = require("../../helpers/brands");
const { throwError } = require("../../utils");
const {
  ROLES,
  SCREENS,
  SYSTEM_VERIFICATION_STATUS,
} = require("../../constants");
const {
  BRAND_VERIFICATION_ACTION,
  BRAND_VERIFICATION_ACTOR,
} = require("../../constants/brandVerification");

/**
 * The vendor tapping "continue" on the approval congratulations screen.
 *
 * Admin approval deliberately leaves the vendor on the UNDER_REVIEW screen so
 * the panel can show the congratulations state (isApproved true +
 * isApprovalAcknowledged false is the trigger). This call is what dismisses it
 * and moves currentScreen to DASHBOARD, so a later login or a refresh goes
 * straight to the dashboard and never shows the message twice.
 *
 * Idempotent — a double tap returns the same payload instead of failing.
 */
exports.acknowledgeBrandApproval = async (userId) => {
  const user = await User.findById(userId);
  if (!user || user.isDeleted) {
    throwError(401, "Unauthorized access. User not found.");
  }
  if (!user.isActive) {
    throwError(
      403,
      "Your account is inactive/deactivated! Please contact support.",
    );
  }
  if (user.role !== ROLES.VENDOR) {
    throwError(403, "You are not authorized to acknowledge brand approval.");
  }
  if (!user.brandId) throwError(400, "Brand not found for user.");

  const brand = await Brand.findOne({
    _id: user.brandId,
    isDeleted: false,
  }).select(
    `
    _id
    uniqueId
    merchantId
    status
    systemVerifyId
    verificationAttemptCount
    isApproved
    isApprovalAcknowledged
    approvalAcknowledgedAt
    `,
  );
  if (!brand) throwError(404, "Brand not found.");

  if (!brand.isApproved) {
    throwError(
      400,
      "Your brand is not approved yet. Please wait for the admin's decision.",
    );
  }

  const alreadyAcknowledged = Boolean(brand.isApprovalAcknowledged);
  const acknowledgedAt = alreadyAcknowledged
    ? brand.approvalAcknowledgedAt
    : new Date();

  if (alreadyAcknowledged && user.currentScreen === SCREENS.DASHBOARD) {
    return {
      brandId: brand._id,
      status: brand.status,
      isApproved: true,
      isApprovalAcknowledged: true,
      approvalAcknowledgedAt: acknowledgedAt,
      currentScreen: SCREENS.DASHBOARD,
    };
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const brandUpdate = await Brand.updateOne(
        { _id: brand._id, isDeleted: false, isApproved: true },
        {
          $set: {
            isApprovalAcknowledged: true,
            approvalAcknowledgedAt: acknowledgedAt,
          },
        },
        { session },
      );
      if (brandUpdate.matchedCount !== 1) {
        throwError(
          409,
          "Brand approval changed while acknowledging. Please refresh and try again.",
        );
      }

      await User.updateOne(
        { _id: user._id, isDeleted: false },
        { $set: { currentScreen: SCREENS.DASHBOARD } },
        { session },
      );

      // Only the first acknowledgement is worth a history row.
      if (!alreadyAcknowledged) {
        await recordBrandVerificationHistory(
          {
            brandId: brand._id,
            systemVerifyId: brand.systemVerifyId,
            action: BRAND_VERIFICATION_ACTION.APPROVAL_ACKNOWLEDGED,
            performedByType: BRAND_VERIFICATION_ACTOR.VENDOR,
            performedBy: user._id,
            attemptNumber: brand.verificationAttemptCount || 1,
            brandUniqueId: brand.uniqueId,
            merchantId: brand.merchantId,
            previousStatus: brand.status,
            newStatus: brand.status,
            metadata: {
              acknowledgedAt,
              previousScreen: user.currentScreen,
              newScreen: SCREENS.DASHBOARD,
            },
          },
          session,
        );
      }
    });
  } finally {
    await session.endSession();
  }

  return {
    brandId: brand._id,
    status: brand.status || SYSTEM_VERIFICATION_STATUS.APPROVED,
    isApproved: true,
    isApprovalAcknowledged: true,
    approvalAcknowledgedAt: acknowledgedAt,
    currentScreen: SCREENS.DASHBOARD,
  };
};
