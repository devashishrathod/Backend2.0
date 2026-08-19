const mongoose = require("mongoose");
const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherApprovalHistory = require("../../models/VoucherApprovalHistory");
const { throwError } = require("../../utils");
const { validateVoucherForApproval } = require("../../helpers/vouchers");
const {
  VOUCHER_STATUSES,
  VOUCHER_APPROVAL_ACTION,
  VOUCHER_OFFER_LIMITS,
} = require("../../constants/voucher");

exports.reviewVoucher = async (adminUserId, versionId, payload = {}) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    if (!adminUserId) {
      throwError(401, "Admin authentication is required.");
    }
    if (!versionId || !mongoose.Types.ObjectId.isValid(versionId)) {
      throwError(400, "Invalid voucher version ID.");
    }
    const action = String(payload.action || "")
      .trim()
      .toUpperCase();
    if (
      ![
        VOUCHER_APPROVAL_ACTION.APPROVED,
        VOUCHER_APPROVAL_ACTION.REJECTED,
      ].includes(action)
    ) {
      throwError(
        400,
        "Invalid review action. Allowed actions are APPROVED or REJECTED.",
      );
    }
    if (action === VOUCHER_APPROVAL_ACTION.REJECTED) {
      const rejectionReason = String(payload.rejectionReason || "").trim();
      if (!rejectionReason) {
        throwError(
          400,
          "Rejection reason is required when rejecting a voucher.",
        );
      }
      if (rejectionReason.length > 1000) {
        throwError(400, "Rejection reason cannot exceed 1000 characters.");
      }
    }
    const version = await VoucherVersion.findOne({
      _id: versionId,
      isDeleted: false,
      isActive: true,
    }).session(session).select(`
        _id
        voucherId
        versionNumber
        versionCode
        status
        name
        offers
        images
        startAt
        endAt
        createdBy
        createdAt
        submittedBy
        submittedAt
        reviewedBy
        reviewedAt
        rejectionReason
      `);

    if (!version) throwError(404, "Voucher version not found.");

    const voucher = await Voucher.findOne({
      _id: version.voucherId,
      isDeleted: false,
      isActive: true,
    }).session(session).select(`
        _id
        brandId
        createdBy
        voucherCode
        currentVersionId
        publishedVersionId
        status
      `);

    if (!voucher) throwError(404, "Voucher not found.");

    if (
      !voucher.currentVersionId ||
      String(voucher.currentVersionId) !== String(version._id)
    ) {
      throwError(409, "This voucher version is no longer the current version.");
    }

    if (
      voucher.publishedVersionId &&
      String(voucher.publishedVersionId) === String(version._id)
    ) {
      throwError(400, "Published voucher version cannot be reviewed.");
    }

    if (voucher.status !== VOUCHER_STATUSES.UNDER_REVIEW) {
      throwError(
        400,
        `Voucher cannot be reviewed from ${voucher.status} status.`,
      );
    }

    if (version.status !== VOUCHER_STATUSES.UNDER_REVIEW) {
      throwError(
        400,
        `Voucher version cannot be reviewed from ${version.status} status.`,
      );
    }

    if (!version.submittedBy) {
      throwError(400, "Voucher version submission information is missing.");
    }

    if (!version.submittedAt) {
      throwError(400, "Voucher version submission timestamp is missing.");
    }

    if (action === VOUCHER_APPROVAL_ACTION.APPROVED) {
      const maxOffers = VOUCHER_OFFER_LIMITS.MAX_OFFERS;
      const validation = await validateVoucherForApproval(
        voucher,
        version,
        maxOffers,
        session,
      );
      const reviewedAt = new Date();
      const versionUpdateResult = await VoucherVersion.updateOne(
        {
          _id: version._id,
          voucherId: voucher._id,
          status: VOUCHER_STATUSES.UNDER_REVIEW,
          isDeleted: false,
          isActive: true,
        },
        {
          $set: {
            status: VOUCHER_STATUSES.APPROVED,
            reviewedBy: adminUserId,
            reviewedAt,
            approvedBy: adminUserId,
            approvedAt: new Date(),
            rejectionReason: null,
          },
        },
        { session },
      );

      if (versionUpdateResult.modifiedCount !== 1) {
        throwError(
          409,
          "Voucher version was already reviewed. Please refresh and try again.",
        );
      }

      const voucherUpdateResult = await Voucher.updateOne(
        {
          _id: voucher._id,
          currentVersionId: version._id,
          status: VOUCHER_STATUSES.UNDER_REVIEW,
          isDeleted: false,
          isActive: true,
        },
        {
          $set: {
            status: VOUCHER_STATUSES.APPROVED,
            updatedBy: adminUserId,
          },
        },
        { session },
      );

      if (voucherUpdateResult.modifiedCount !== 1) {
        throwError(
          409,
          "Voucher status changed while reviewing. Please try again.",
        );
      }

      await VoucherApprovalHistory.create(
        [
          {
            voucherId: voucher._id,
            voucherVersionId: version._id,
            brandId: voucher.brandId,
            action: VOUCHER_APPROVAL_ACTION.APPROVED,
            performedBy: adminUserId,
            versionNumber: version.versionNumber,
            voucherCode: voucher.voucherCode,
            versionCode: version.versionCode,
            reason: null,
            metadata: {
              previousVoucherStatus: VOUCHER_STATUSES.UNDER_REVIEW,
              previousVersionStatus: VOUCHER_STATUSES.UNDER_REVIEW,
              newVoucherStatus: VOUCHER_STATUSES.APPROVED,
              newVersionStatus: VOUCHER_STATUSES.APPROVED,
              offerCount: validation.offers.length,
              imageCount: validation.imageCount,
              subBrandCount: validation.subBrandCount,
              startAt: validation.startAt,
              endAt: validation.endAt,
              submittedBy: version.submittedBy,
              submittedAt: version.submittedAt,
              reviewedBy: adminUserId,
              reviewedAt,
            },
          },
        ],
        { session },
      );
      await session.commitTransaction();
      return {
        voucherId: voucher._id,
        versionId: version._id,
        voucherCode: voucher.voucherCode,
        versionCode: version.versionCode,
        versionNo: version.versionNumber,
        action: VOUCHER_APPROVAL_ACTION.APPROVED,
        voucherStatus: VOUCHER_STATUSES.APPROVED,
        versionStatus: VOUCHER_STATUSES.APPROVED,
        reviewedBy: adminUserId,
        reviewedAt,
        startAt: validation.startAt,
        endAt: validation.endAt,
        offerCount: validation.offers.length,
        imageCount: validation.imageCount,
        subBrandCount: validation.subBrandCount,
      };
    }

    const reviewedAt = new Date();
    const rejectionReason = String(payload.rejectionReason).trim();

    const versionUpdateResult = await VoucherVersion.updateOne(
      {
        _id: version._id,
        voucherId: voucher._id,
        status: VOUCHER_STATUSES.UNDER_REVIEW,
        isDeleted: false,
        isActive: true,
      },
      {
        $set: {
          status: VOUCHER_STATUSES.REJECTED,
          reviewedBy: adminUserId,
          reviewedAt,
          rejectedBy: adminUserId,
          rejectedAt: new Date(),
          rejectionReason,
        },
      },
      { session },
    );
    if (versionUpdateResult.modifiedCount !== 1) {
      throwError(
        409,
        "Voucher version was already reviewed. Please refresh and try again.",
      );
    }

    const voucherUpdateResult = await Voucher.updateOne(
      {
        _id: voucher._id,
        currentVersionId: version._id,
        status: VOUCHER_STATUSES.UNDER_REVIEW,
        isDeleted: false,
        isActive: true,
      },
      {
        $set: {
          status: VOUCHER_STATUSES.REJECTED,
          updatedBy: adminUserId,
        },
      },
      { session },
    );
    if (voucherUpdateResult.modifiedCount !== 1) {
      throwError(
        409,
        "Voucher status changed while rejecting. Please try again.",
      );
    }

    await VoucherApprovalHistory.create(
      [
        {
          voucherId: voucher._id,
          voucherVersionId: version._id,
          brandId: voucher.brandId,
          action: VOUCHER_APPROVAL_ACTION.REJECTED,
          performedBy: adminUserId,
          versionNumber: version.versionNumber,
          voucherCode: voucher.voucherCode,
          versionCode: version.versionCode,
          reason: rejectionReason,
          metadata: {
            previousVoucherStatus: VOUCHER_STATUSES.UNDER_REVIEW,
            previousVersionStatus: VOUCHER_STATUSES.UNDER_REVIEW,
            newVoucherStatus: VOUCHER_STATUSES.REJECTED,
            newVersionStatus: VOUCHER_STATUSES.REJECTED,
            submittedBy: version.submittedBy,
            submittedAt: version.submittedAt,
            reviewedBy: adminUserId,
            reviewedAt,
            rejectionReason,
          },
        },
      ],
      { session },
    );
    await session.commitTransaction();
    return {
      voucherId: voucher._id,
      versionId: version._id,
      voucherCode: voucher.voucherCode,
      versionCode: version.versionCode,
      versionNo: version.versionNumber,
      action: VOUCHER_APPROVAL_ACTION.REJECTED,
      voucherStatus: VOUCHER_STATUSES.REJECTED,
      versionStatus: VOUCHER_STATUSES.REJECTED,
      rejectionReason,
      reviewedBy: adminUserId,
      reviewedAt,
    };
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    await session.endSession();
  }
};
