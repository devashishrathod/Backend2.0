const mongoose = require("mongoose");
const Brand = require("../../models/Brand");
const SystemVerify = require("../../models/SystemVerify");
const { recordBrandVerificationHistory } = require("../../helpers/brands");
const { throwError } = require("../../utils");
const {
  SYSTEM_VERIFICATION_STATUS,
  BRAND_SYSTEM_VERIFY_UPDATED_BY,
} = require("../../constants");
const {
  BRAND_VERIFICATION_ACTION,
  BRAND_VERIFICATION_ADMIN_ACTION,
  BRAND_VERIFICATION_ACTOR,
  BRAND_VERIFICATION_LIMITS,
} = require("../../constants/brandVerification");

// Records created before these flags existed have the field absent, and in
// Mongo an absent field does not equal false. Every boolean guard therefore
// asks for "not true" rather than "false", so older brands stay actionable.
const boolGuard = (value) => (value ? true : { $ne: true });

/**
 * Admin decision on a brand's current system-verification attempt.
 *
 * APPROVED — settles the brand. If the system had already scored it APPROVED,
 *            only the review/admin-approval flags move and verifiedBy stays
 *            SYSTEM. If the system said MANUAL_REVIEW / REJECTED / PENDING,
 *            this is a manual override: status becomes APPROVED and
 *            verifiedBy/verifiedAt switch over to ADMIN.
 * REJECTED — reason is mandatory; rejectedBy/rejectedAt move to ADMIN even
 *            when the system had already rejected it. Only once per attempt —
 *            the vendor has to resubmit before it can be rejected again.
 * REVIEWED — pure "seen" toggle. Never touches the status, and each flip is
 *            its own REVIEWED / UNREVIEWED history row.
 * REVOKED  — withdraws an approval that was already granted. Reason is
 *            mandatory. The attempt becomes actionable again, so an admin can
 *            re-approve it or the vendor can resubmit fresh documents.
 *
 * A brand only becomes isApproved once an admin has reviewed it *and* the
 * status is APPROVED — which is exactly what the APPROVED action does.
 *
 * This never touches user.currentScreen. On approval the vendor stays on the
 * UNDER_REVIEW screen to see the congratulations state, and moving on to the
 * dashboard is the vendor's own acknowledgeBrandApproval call.
 */
exports.reviewBrandVerification = async (
  adminUserId,
  brandId,
  payload = {},
) => {
  if (!adminUserId) throwError(401, "Admin authentication is required.");
  if (!brandId || !mongoose.Types.ObjectId.isValid(brandId)) {
    throwError(400, "Invalid brand ID.");
  }

  const action = String(payload.action || "")
    .trim()
    .toUpperCase();
  if (!Object.values(BRAND_VERIFICATION_ADMIN_ACTION).includes(action)) {
    throwError(
      400,
      `Invalid review action. Allowed actions are ${Object.values(
        BRAND_VERIFICATION_ADMIN_ACTION,
      ).join(", ")}.`,
    );
  }

  const rejectionReason = payload.rejectionReason
    ? String(payload.rejectionReason).trim()
    : "";
  const revokeReason = payload.revokeReason
    ? String(payload.revokeReason).trim()
    : "";
  const note = payload.note ? String(payload.note).trim() : "";

  const requireReason = (value, missingMessage, label) => {
    if (!value) throwError(400, missingMessage);
    if (value.length > BRAND_VERIFICATION_LIMITS.MAX_REASON_LENGTH) {
      throwError(
        400,
        `${label} cannot exceed ${BRAND_VERIFICATION_LIMITS.MAX_REASON_LENGTH} characters.`,
      );
    }
  };

  if (action === BRAND_VERIFICATION_ADMIN_ACTION.REJECTED) {
    requireReason(
      rejectionReason,
      "Rejection reason is required when rejecting a brand.",
      "Rejection reason",
    );
  }
  if (action === BRAND_VERIFICATION_ADMIN_ACTION.REVOKED) {
    requireReason(
      revokeReason,
      "Revoke reason is required when revoking an approval.",
      "Revoke reason",
    );
  }
  if (note.length > BRAND_VERIFICATION_LIMITS.MAX_NOTE_LENGTH) {
    throwError(
      400,
      `Note cannot exceed ${BRAND_VERIFICATION_LIMITS.MAX_NOTE_LENGTH} characters.`,
    );
  }

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      const brand = await Brand.findOne({ _id: brandId, isDeleted: false })
        .select(
          `
          _id
          userId
          uniqueId
          merchantId
          brandName
          status
          systemVerifyId
          verificationAttemptCount
          isApproved
          isReviewed
          isRejected
          isRevoked
        `,
        )
        .session(session);
      if (!brand) throwError(404, "Brand not found.");
      if (!brand.systemVerifyId) {
        throwError(
          400,
          "System verification has not been completed for this brand yet.",
        );
      }

      const systemVerify = await SystemVerify.findOne({
        _id: brand.systemVerifyId,
        isDeleted: false,
      }).session(session);
      if (!systemVerify) {
        throwError(404, "Brand's system verification record not found.");
      }
      if (systemVerify.isSuperseded) {
        throwError(
          409,
          "This verification attempt was superseded by a newer submission. Please refresh and act on the latest one.",
        );
      }

      const now = new Date();
      const previousStatus = systemVerify.status;
      const previousBrandStatus = brand.status;
      const attemptNumber = systemVerify.attemptNumber || 1;
      const isCurrentlyApproved = Boolean(
        systemVerify.isAdminApproved && brand.isApproved,
      );

      let newStatus = previousStatus;
      let historyAction;
      let historyReason = note || null;
      let systemVerifySet = {};
      let brandSet = {};

      if (action === BRAND_VERIFICATION_ADMIN_ACTION.APPROVED) {
        if (isCurrentlyApproved) {
          throwError(409, "This brand is already approved.");
        }

        // The system's own verdict is preserved when it had already cleared
        // the brand — confirming it is a review, not a re-verification.
        const wasSystemApproved =
          previousStatus === SYSTEM_VERIFICATION_STATUS.APPROVED &&
          systemVerify.verifiedBy === BRAND_SYSTEM_VERIFY_UPDATED_BY.SYSTEM;

        // Preserve whoever reviewed it first; approving only fills the
        // reviewer in when nobody had marked it reviewed yet.
        const alreadyReviewed = Boolean(
          systemVerify.isReviewed && systemVerify.reviewedAt,
        );
        const reviewedByAdminId = alreadyReviewed
          ? systemVerify.reviewedByAdminId || adminUserId
          : adminUserId;
        const reviewedAt = alreadyReviewed ? systemVerify.reviewedAt : now;

        newStatus = SYSTEM_VERIFICATION_STATUS.APPROVED;
        historyAction = BRAND_VERIFICATION_ACTION.APPROVED;

        systemVerifySet = {
          status: SYSTEM_VERIFICATION_STATUS.APPROVED,
          isAdminApproved: true,
          isReviewed: true,
          isRejected: false,
          isRevoked: false,
          reviewedByAdminId,
          reviewedAt,
          adminApprovedAt: now,
          rejectedBy: null,
          rejectedByAdminId: null,
          rejectedAt: null,
          rejectionReason: null,
          revokedBy: null,
          revokedByAdminId: null,
          revokedAt: null,
          revokeReason: null,
          ...(wasSystemApproved
            ? {}
            : {
                verifiedBy: BRAND_SYSTEM_VERIFY_UPDATED_BY.ADMIN,
                verifiedByAdminId: adminUserId,
                verifiedAt: now,
              }),
        };

        brandSet = {
          status: SYSTEM_VERIFICATION_STATUS.APPROVED,
          isApproved: true,
          isReviewed: true,
          isRejected: false,
          isRevoked: false,
          verifiedBy: wasSystemApproved
            ? BRAND_SYSTEM_VERIFY_UPDATED_BY.SYSTEM
            : BRAND_SYSTEM_VERIFY_UPDATED_BY.ADMIN,
          verifiedAt: wasSystemApproved ? systemVerify.verifiedAt || now : now,
          reviewedByAdminId,
          reviewedAt,
          approvedByAdminId: adminUserId,
          approvedAt: now,
          rejectedByAdminId: null,
          rejectedAt: null,
          rejectionReason: null,
          revokedByAdminId: null,
          revokedAt: null,
          revokeReason: null,
          // The vendor has a fresh approval to acknowledge, so the
          // congratulations screen is armed again.
          isApprovalAcknowledged: false,
          approvalAcknowledgedAt: null,
        };
      } else if (action === BRAND_VERIFICATION_ADMIN_ACTION.REJECTED) {
        if (isCurrentlyApproved) {
          throwError(
            409,
            "An approved brand cannot be rejected. Revoke the approval instead.",
          );
        }
        // A second admin rejection of the same attempt would be a duplicate
        // decision — the vendor has to resubmit first. A system rejection is
        // not an admin decision, so overriding that is still allowed.
        if (
          systemVerify.isRejected &&
          systemVerify.rejectedBy === BRAND_SYSTEM_VERIFY_UPDATED_BY.ADMIN
        ) {
          throwError(
            409,
            "This verification attempt is already rejected. The vendor must resubmit before it can be actioned again.",
          );
        }

        newStatus = SYSTEM_VERIFICATION_STATUS.REJECTED;
        historyAction = BRAND_VERIFICATION_ACTION.REJECTED;
        historyReason = rejectionReason;

        systemVerifySet = {
          status: SYSTEM_VERIFICATION_STATUS.REJECTED,
          isRejected: true,
          isReviewed: true,
          isAdminApproved: false,
          rejectedBy: BRAND_SYSTEM_VERIFY_UPDATED_BY.ADMIN,
          rejectedByAdminId: adminUserId,
          rejectedAt: now,
          rejectionReason,
          reviewedByAdminId: adminUserId,
          reviewedAt: now,
          adminApprovedAt: null,
        };

        brandSet = {
          status: SYSTEM_VERIFICATION_STATUS.REJECTED,
          isApproved: false,
          isRejected: true,
          isReviewed: true,
          rejectedByAdminId: adminUserId,
          rejectedAt: now,
          rejectionReason,
          approvedByAdminId: null,
          approvedAt: null,
          verifiedBy: null,
          verifiedAt: null,
        };
      } else if (action === BRAND_VERIFICATION_ADMIN_ACTION.REVOKED) {
        if (!isCurrentlyApproved) {
          throwError(
            409,
            "Only an approved brand can have its approval revoked.",
          );
        }

        newStatus = SYSTEM_VERIFICATION_STATUS.REVOKED;
        historyAction = BRAND_VERIFICATION_ACTION.REVOKED;
        historyReason = revokeReason;

        // isAdminApproved goes back to false, which puts the attempt back in
        // the admin's queue: it can be approved again, or the vendor can
        // resubmit fresh documents.
        systemVerifySet = {
          status: SYSTEM_VERIFICATION_STATUS.REVOKED,
          isAdminApproved: false,
          isRevoked: true,
          isReviewed: true,
          revokedBy: BRAND_SYSTEM_VERIFY_UPDATED_BY.ADMIN,
          revokedByAdminId: adminUserId,
          revokedAt: now,
          revokeReason,
          reviewedByAdminId: adminUserId,
          reviewedAt: now,
          adminApprovedAt: null,
        };

        brandSet = {
          status: SYSTEM_VERIFICATION_STATUS.REVOKED,
          isApproved: false,
          isRevoked: true,
          isReviewed: true,
          revokedByAdminId: adminUserId,
          revokedAt: now,
          revokeReason,
          approvedByAdminId: null,
          approvedAt: null,
          verifiedBy: null,
          verifiedAt: null,
          isApprovalAcknowledged: false,
          approvalAcknowledgedAt: null,
        };
      } else {
        // REVIEWED — a toggle, nothing more.
        if (isCurrentlyApproved) {
          throwError(
            409,
            "The reviewed flag cannot be changed for an already approved brand.",
          );
        }

        const nextIsReviewed =
          payload.isReviewed === undefined
            ? !systemVerify.isReviewed
            : Boolean(payload.isReviewed);

        if (nextIsReviewed === Boolean(systemVerify.isReviewed)) {
          throwError(
            400,
            `This brand's verification is already marked as ${
              nextIsReviewed ? "reviewed" : "not reviewed"
            }.`,
          );
        }

        historyAction = nextIsReviewed
          ? BRAND_VERIFICATION_ACTION.REVIEWED
          : BRAND_VERIFICATION_ACTION.UNREVIEWED;

        systemVerifySet = {
          isReviewed: nextIsReviewed,
          reviewedByAdminId: nextIsReviewed ? adminUserId : null,
          reviewedAt: nextIsReviewed ? now : null,
        };

        brandSet = {
          isReviewed: nextIsReviewed,
          reviewedByAdminId: nextIsReviewed ? adminUserId : null,
          reviewedAt: nextIsReviewed ? now : null,
        };
      }

      // Optimistic guard: refuse the write if another admin moved this record
      // between our read and our update.
      const systemVerifyUpdate = await SystemVerify.updateOne(
        {
          _id: systemVerify._id,
          isDeleted: false,
          isSuperseded: { $ne: true },
          status: previousStatus,
          isReviewed: boolGuard(systemVerify.isReviewed),
          isRejected: boolGuard(systemVerify.isRejected),
          isRevoked: boolGuard(systemVerify.isRevoked),
          isAdminApproved: boolGuard(systemVerify.isAdminApproved),
        },
        { $set: systemVerifySet },
        { session },
      );
      if (systemVerifyUpdate.matchedCount !== 1) {
        throwError(
          409,
          "This brand verification was updated by someone else. Please refresh and try again.",
        );
      }

      const brandUpdate = await Brand.updateOne(
        {
          _id: brand._id,
          isDeleted: false,
          systemVerifyId: systemVerify._id,
        },
        { $set: brandSet },
        { session },
      );
      if (brandUpdate.matchedCount !== 1) {
        throwError(
          409,
          "Brand state changed while reviewing. Please refresh and try again.",
        );
      }

      const history = await recordBrandVerificationHistory(
        {
          brandId: brand._id,
          systemVerifyId: systemVerify._id,
          action: historyAction,
          performedByType: BRAND_VERIFICATION_ACTOR.ADMIN,
          performedBy: adminUserId,
          attemptNumber,
          brandUniqueId: brand.uniqueId,
          merchantId: brand.merchantId,
          score: systemVerify.score,
          previousStatus,
          newStatus,
          reason: historyReason,
          metadata: {
            requestedAction: action,
            previousBrandStatus,
            newBrandStatus: brandSet.status || previousBrandStatus,
            previousFlags: {
              isReviewed: Boolean(systemVerify.isReviewed),
              isRejected: Boolean(systemVerify.isRejected),
              isRevoked: Boolean(systemVerify.isRevoked),
              isAdminApproved: Boolean(systemVerify.isAdminApproved),
              isBrandApproved: Boolean(brand.isApproved),
            },
            newFlags: {
              isReviewed:
                systemVerifySet.isReviewed ?? Boolean(systemVerify.isReviewed),
              isRejected:
                systemVerifySet.isRejected ?? Boolean(systemVerify.isRejected),
              isRevoked:
                systemVerifySet.isRevoked ?? Boolean(systemVerify.isRevoked),
              isAdminApproved:
                systemVerifySet.isAdminApproved ??
                Boolean(systemVerify.isAdminApproved),
              isBrandApproved: brandSet.isApproved ?? Boolean(brand.isApproved),
            },
            systemScore: systemVerify.score,
            systemRemarks: systemVerify.remarks,
            note: note || null,
            manualOverride:
              action === BRAND_VERIFICATION_ADMIN_ACTION.APPROVED &&
              previousStatus !== SYSTEM_VERIFICATION_STATUS.APPROVED,
          },
        },
        session,
      );

      result = {
        brandId: brand._id,
        brandName: brand.brandName,
        brandUniqueId: brand.uniqueId,
        merchantId: brand.merchantId,
        systemVerifyId: systemVerify._id,
        historyId: history._id,
        action: historyAction,
        attemptNumber,
        score: systemVerify.score,
        previousStatus,
        status: newStatus,
        brandStatus: brandSet.status || previousBrandStatus,
        isReviewed:
          systemVerifySet.isReviewed ?? Boolean(systemVerify.isReviewed),
        isRejected:
          systemVerifySet.isRejected ?? Boolean(systemVerify.isRejected),
        isRevoked: systemVerifySet.isRevoked ?? Boolean(systemVerify.isRevoked),
        isAdminApproved:
          systemVerifySet.isAdminApproved ??
          Boolean(systemVerify.isAdminApproved),
        isApproved: brandSet.isApproved ?? Boolean(brand.isApproved),
        verifiedBy: brandSet.verifiedBy ?? systemVerify.verifiedBy,
        rejectionReason: brandSet.rejectionReason ?? null,
        revokeReason: brandSet.revokeReason ?? null,
        reviewedBy: adminUserId,
        reviewedAt: now,
      };
    });
  } finally {
    await session.endSession();
  }

  return result;
};
