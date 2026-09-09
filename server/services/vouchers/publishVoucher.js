const mongoose = require("mongoose");
const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherApprovalHistory = require("../../models/VoucherApprovalHistory");
const { throwError } = require("../../utils");
const {
  VOUCHER_STATUSES,
  VOUCHER_APPROVAL_ACTION,
} = require("../../constants/voucher");

exports.publishVoucher = async (userId, versionId) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    if (!userId) throwError(401, "User authentication is required.");
    if (!versionId || !mongoose.Types.ObjectId.isValid(versionId)) {
      throwError(400, "Invalid voucher version ID.");
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
        startAt
        endAt
        isImmutable
        isActive
        publishedAt
      `);

    if (!version) throwError(404, "Voucher version not found.");

    if (version.status !== VOUCHER_STATUSES.APPROVED) {
      throwError(
        400,
        `Only an approved voucher version can be published. Current status: ${version.status}.`,
      );
    }

    if (version.isImmutable) {
      throwError(
        400,
        "This voucher version is already immutable and cannot be published again.",
      );
    }

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
        currentPublishedVersionId
        status
      `);

    if (!voucher) throwError(404, "Voucher not found.");

    if (
      !voucher.currentVersionId ||
      String(voucher.currentVersionId) !== String(version._id)
    ) {
      throwError(
        409,
        "This voucher version is no longer the current version and cannot be published.",
      );
    }

    if (voucher.status !== VOUCHER_STATUSES.APPROVED) {
      throwError(
        400,
        `Voucher cannot be published from ${voucher.status} status.`,
      );
    }

    if (!version.startAt || !version.endAt) {
      throwError(400, "Voucher validity period is required.");
    }

    if (version.endAt <= version.startAt) {
      throwError(
        400,
        "Voucher end date/time must be after voucher start date/time.",
      );
    }

    const now = new Date();
    if (version.endAt <= now) {
      throwError(400, "Cannot publish an expired voucher version.");
    }

    if (version.startAt <= now) {
      throwError(400, "Voucher start date/time must be in the future.");
    }

    const previousPublishedVersions = await VoucherVersion.find({
      voucherId: voucher._id,
      status: VOUCHER_STATUSES.PUBLISHED,
      _id: { $ne: version._id },
      isDeleted: false,
    }).session(session).select(`
          _id
          versionNumber
          versionCode
          status
          publishedAt
        `);

    const publishedAt = new Date();

    /**
     * The version this one replaces is retired **first**, and as **ARCHIVED**.
     *
     * ### ⚠️ Order is load-bearing — this is an index constraint, not a style choice
     *
     * `voucherId_1_status_1` is a partial unique index on
     * `{ status: "PUBLISHED", isDeleted: false }`: a voucher may have exactly one
     * published version. Publishing the new one *before* retiring the old one
     * leaves both `PUBLISHED` for the width of a single statement — and inside a
     * transaction Mongo enforces a unique index on the write, not at commit. So
     * that ordering did not merely race; it **failed every time**, with
     * `E11000 … dup key: { voucherId, status: "PUBLISHED" }`.
     *
     * The effect was that a voucher which already had a published version could
     * never publish another — the vendor's second version was refused with a
     * duplicate-key error naming a field they never touched.
     *
     * ### Why ARCHIVED and not EXPIRED
     *
     * Two different things were collapsing into one word. A version can leave
     * circulation because the vendor published a newer one, or because its own
     * `endAt` arrived — and only the second is an expiry. Marking a supersede as
     * `EXPIRED` made a voucher whose validity ran another three months look like
     * one whose time was up, and no report could tell the two apart afterwards.
     *
     * `archivedAt` records when it was replaced. `expireVouchers` then carries it
     * on to `EXPIRED` when `endAt` genuinely passes, so the archived state is a
     * stage in the life of a version rather than a dead end.
     */
    if (previousPublishedVersions.length > 0) {
      const archiveResult = await VoucherVersion.updateMany(
        {
          voucherId: voucher._id,
          status: VOUCHER_STATUSES.PUBLISHED,
          _id: { $ne: version._id },
          isDeleted: false,
        },
        {
          $set: {
            status: VOUCHER_STATUSES.ARCHIVED,
            archivedAt: publishedAt,
            isActive: false,
            updatedBy: userId,
          },
        },
        { session },
      );

      if (archiveResult.modifiedCount !== previousPublishedVersions.length) {
        throwError(
          409,
          "Previous published voucher version changed while publishing. Please try again.",
        );
      }
    }

    // Only now is the published slot free.
    const versionUpdateResult = await VoucherVersion.updateOne(
      {
        _id: version._id,
        voucherId: voucher._id,
        status: VOUCHER_STATUSES.APPROVED,
        isDeleted: false,
        isActive: true,
        isImmutable: { $ne: true },
      },
      {
        $set: {
          status: VOUCHER_STATUSES.PUBLISHED,
          publishedAt,
          isImmutable: true,
          isActive: true,
          updatedBy: userId,
        },
      },
      { session },
    );

    if (versionUpdateResult.modifiedCount !== 1) {
      throwError(
        409,
        "Voucher version was already published or its status changed. Please refresh and try again.",
      );
    }

    const voucherUpdateResult = await Voucher.updateOne(
      {
        _id: voucher._id,
        currentVersionId: version._id,
        status: VOUCHER_STATUSES.APPROVED,
        isDeleted: false,
        isActive: true,
      },
      {
        $set: {
          publishedVersion: version.versionNumber,
          publishedVersionId: version._id,
          isActive: true,
          updatedBy: userId,
        },
      },
      { session },
    );

    if (voucherUpdateResult.modifiedCount !== 1) {
      throwError(
        409,
        "Voucher status changed while publishing. Please refresh and try again.",
      );
    }

    await VoucherApprovalHistory.create(
      [
        {
          voucherId: voucher._id,
          voucherVersionId: version._id,
          brandId: voucher.brandId,
          action: VOUCHER_APPROVAL_ACTION.PUBLISHED,
          performedBy: userId,
          versionNumber: version.versionNumber,
          voucherCode: voucher.voucherCode,
          versionCode: version.versionCode,
          reason: null,
          metadata: {
            previousVoucherStatus: VOUCHER_STATUSES.APPROVED,
            previousVersionStatus: VOUCHER_STATUSES.APPROVED,
            newVoucherStatus: VOUCHER_STATUSES.APPROVED,
            newVersionStatus: VOUCHER_STATUSES.PUBLISHED,
            publishedVersionId: version._id,
            publishedAt,
            previousPublishedVersionIds: previousPublishedVersions.map(
              (item) => item._id,
            ),
            previousPublishedVersions: previousPublishedVersions.map(
              (item) => ({
                versionId: item._id,
                versionNumber: item.versionNumber,
                versionCode: item.versionCode,
                publishedAt: item.publishedAt,
              }),
            ),
            publishedBy: userId,
          },
        },
      ],
      { session },
    );

    if (previousPublishedVersions.length > 0) {
      const archiveHistory = previousPublishedVersions.map((oldVersion) => ({
        voucherId: voucher._id,
        voucherVersionId: oldVersion._id,
        brandId: voucher.brandId,
        action: VOUCHER_APPROVAL_ACTION.ARCHIVED,
        performedBy: userId,
        versionNumber: oldVersion.versionNumber,
        voucherCode: voucher.voucherCode,
        versionCode: oldVersion.versionCode,
        reason:
          "Previous published version archived — replaced by a newer published version.",
        metadata: {
          previousVoucherStatus: VOUCHER_STATUSES.APPROVED,
          previousVersionStatus: VOUCHER_STATUSES.PUBLISHED,
          newVersionStatus: VOUCHER_STATUSES.ARCHIVED,
          replacedByVersionId: version._id,
          replacedByVersionNumber: version.versionNumber,
          replacedByVersionCode: version.versionCode,
          archivedAt: publishedAt,
          archivedBy: userId,
        },
      }));
      await VoucherApprovalHistory.insertMany(archiveHistory, { session });
    }
    await session.commitTransaction();
    return {
      voucherId: voucher._id,
      versionId: version._id,
      voucherCode: voucher.voucherCode,
      versionCode: version.versionCode,
      versionNo: version.versionNumber,
      action: VOUCHER_APPROVAL_ACTION.PUBLISHED,
      voucherStatus: VOUCHER_STATUSES.APPROVED,
      versionStatus: VOUCHER_STATUSES.PUBLISHED,
      publishedVersionId: version._id,
      publishedAt,
      publishedBy: userId,
      previousPublishedVersions: previousPublishedVersions.map((item) => ({
        versionId: item._id,
        versionNumber: item.versionNumber,
        versionCode: item.versionCode,
      })),
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
