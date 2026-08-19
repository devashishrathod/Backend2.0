const mongoose = require("mongoose");
const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherApprovalHistory = require("../../models/VoucherApprovalHistory");
const { throwError } = require("../../utils");
const { validateVoucherBeforeSubmit } = require("../../helpers/vouchers");
const {
  VOUCHER_STATUSES,
  VOUCHER_OFFER_LIMITS,
  VOUCHER_APPROVAL_ACTION,
} = require("../../constants/voucher");

exports.submitVoucherForReview = async (userId, voucherId) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const voucher = await Voucher.findOne({
      _id: voucherId,
      isDeleted: false,
      isActive: true,
    })
      .session(session)
      .select(
        "_id brandId createdBy currentVersionId publishedVersionId status voucherCode",
      );

    if (!voucher) throwError(404, "Voucher not found.");

    if (String(voucher.createdBy) !== String(userId)) {
      throwError(403, "You are not authorized to submit this voucher.");
    }
    if (!voucher.currentVersionId) {
      throwError(400, "Voucher has no editable version.");
    }

    const version = await VoucherVersion.findOne({
      _id: voucher.currentVersionId,
      voucherId: voucher._id,
      isDeleted: false,
      isActive: true,
    }).session(session);

    if (!version) throwError(404, "Voucher version not found.");

    if (
      voucher.publishedVersionId &&
      String(voucher.publishedVersionId) === String(voucher.currentVersionId)
    ) {
      throwError(
        400,
        "Published voucher cannot be submitted directly. Create a new version first.",
      );
    }

    const maxOffers = VOUCHER_OFFER_LIMITS.MAX_OFFERS;

    const validation = await validateVoucherBeforeSubmit(
      voucher,
      version,
      maxOffers,
      session,
    );

    const updateResult = await Voucher.updateOne(
      {
        _id: voucher._id,
        status: { $in: [VOUCHER_STATUSES.DRAFT, VOUCHER_STATUSES.REJECTED] },
        currentVersionId: version._id,
        isDeleted: false,
      },
      {
        $set: {
          status: VOUCHER_STATUSES.UNDER_REVIEW,
          updatedBy: userId,
        },
      },
      { session },
    );

    if (updateResult.modifiedCount !== 1) {
      throwError(409, "Voucher status changed. Please refresh and try again.");
    }

    const versionUpdateResult = await VoucherVersion.updateOne(
      {
        _id: version._id,
        voucherId: voucher._id,
        status: { $in: [VOUCHER_STATUSES.DRAFT, VOUCHER_STATUSES.REJECTED] },
        isDeleted: false,
      },
      {
        $set: {
          status: VOUCHER_STATUSES.UNDER_REVIEW,
          submittedBy: userId,
          submittedAt: new Date(),
          rejectedBy: null,
          rejectedAt: null,
          rejectionReason: null,
        },
      },
      { session },
    );

    if (versionUpdateResult.modifiedCount !== 1) {
      throwError(
        409,
        "Voucher version status changed. Please refresh and try again.",
      );
    }

    await VoucherApprovalHistory.create(
      [
        {
          voucherId: voucher._id,
          voucherVersionId: version._id,
          brandId: voucher.brandId,
          action: VOUCHER_APPROVAL_ACTION.SUBMITTED,
          performedBy: userId,
          versionNumber: version.versionNumber,
          voucherCode: voucher.voucherCode,
          versionCode: version.versionCode,
          reason: null,
          metadata: {
            previousVoucherStatus: voucher.status,
            previousVersionStatus: version.status,
            newVoucherStatus: VOUCHER_STATUSES.UNDER_REVIEW,
            newVersionStatus: VOUCHER_STATUSES.UNDER_REVIEW,
            offerCount: validation.offers.length,
            imageCount: validation.imageCount,
            subBrandCount: validation.subBrandCount,
            startAt: validation.startAt,
            endAt: validation.endAt,
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
      status: VOUCHER_STATUSES.UNDER_REVIEW,
      submittedAt: new Date(),
      startAt: validation.startAt,
      endAt: validation.endAt,
      offerCount: validation.offers.length,
      imageCount: validation.imageCount,
      subBrandCount: validation.subBrandCount,
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
