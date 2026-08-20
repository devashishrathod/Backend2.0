const mongoose = require("mongoose");
const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherSubBrand = require("../../models/VoucherSubBrand");
const { throwError } = require("../../utils");
const {
  getUniqueTags,
  validateVoucherDates,
  validateVoucherSubBrands,
  normalizeVoucherImages,
  validateVoucherImages,
  uploadVoucherImages,
  rollbackVoucherImages,
  generateVoucherVersionCode,
  getNextVersionNumber,
  createVoucherHistory,
} = require("../../helpers/vouchers");
const {
  validateVoucherOffers,
  normalizeVoucherOffers,
} = require("../../helpers/voucherOffers");
const {
  VOUCHER_STATUSES,
  VOUCHER_APPROVAL_ACTION,
} = require("../../constants/voucher");
const { getVoucherConfig } = require("../../helpers/settings");

const mergeTags = (existingTags = [], newTags = [], removedTags = []) => {
  const removeSet = new Set(
    (removedTags || [])
      .map((tag) => String(tag).trim().toLowerCase())
      .filter(Boolean),
  );
  const kept = getUniqueTags(existingTags || []).filter(
    (tag) => !removeSet.has(tag.toLowerCase()),
  );
  return getUniqueTags([...kept, ...(newTags || [])]);
};

const mergeOffers = (
  existingOffers = [],
  newOffers = [],
  removedOfferIds = [],
  maxOffers,
) => {
  const removeSet = new Set((removedOfferIds || []).map(String));
  const kept = (existingOffers || [])
    .filter((offer) => !removeSet.has(String(offer._id)))
    .map((offer) => ({
      _id: offer._id,
      title: offer.title,
      minBillAmount: offer.minBillAmount,
      discountType: offer.discountType,
      discountValue: offer.discountValue,
      maxDiscountAmount:
        offer.maxDiscountAmount === undefined ||
        offer.maxDiscountAmount === null
          ? null
          : offer.maxDiscountAmount,
      usageType: offer.usageType,
      discountApplicableOn: offer.discountApplicableOn,
      isActive: offer.isActive !== false,
    }));

  const added =
    Array.isArray(newOffers) && newOffers.length
      ? normalizeVoucherOffers(newOffers).map(({ sortOrder, ...rest }) => rest)
      : [];

  const combined = [...kept, ...added];
  if (!combined.length) throwError(400, "At least one offer is required.");
  validateVoucherOffers(combined, maxOffers);

  return combined
    .sort((a, b) => a.minBillAmount - b.minBillAmount)
    .map((offer, index) => ({ ...offer, sortOrder: index + 1 }));
};

const mergeImages = (
  existingImages = [],
  uploadedImages = [],
  removeImageIds = [],
  maxImages,
) => {
  const removeSet = new Set((removeImageIds || []).map(String));
  const kept = (existingImages || []).filter(
    (image) => !removeSet.has(String(image._id)),
  );
  const removedImages = (existingImages || []).filter((image) =>
    removeSet.has(String(image._id)),
  );

  const keptImages = kept.map((image) => ({
    _id: image._id,
    url: image.url,
    storage: image.storage,
  }));
  const addedImages = (uploadedImages || []).map((image) => ({
    url: image.url,
    storage: image.storage,
  }));

  const combined = [...keptImages, ...addedImages];
  if (!combined.length) {
    throwError(400, "At least one voucher image is required.");
  }
  if (combined.length > maxImages) {
    throwError(400, `Maximum ${maxImages} voucher images are allowed.`);
  }

  return {
    finalImages: combined.map((image, index) => ({
      ...image,
      sortOrder: index + 1,
    })),
    removedImages,
  };
};

const mergeSubBrands = async ({
  existingSubBrandDocs,
  newSubBrandIds,
  removeSubBrandIds,
  brandId,
  session,
}) => {
  const removeSet = new Set((removeSubBrandIds || []).map(String));
  const keptDocs = (existingSubBrandDocs || []).filter(
    (doc) => !removeSet.has(String(doc.subBrandId)),
  );
  const keptIds = new Set(keptDocs.map((doc) => String(doc.subBrandId)));

  let addedSubBrands = [];
  if (Array.isArray(newSubBrandIds) && newSubBrandIds.length) {
    const uniqueNewIds = [...new Set(newSubBrandIds.map(String))].filter(
      (id) => !keptIds.has(id),
    );
    if (uniqueNewIds.length) {
      addedSubBrands = await validateVoucherSubBrands(
        uniqueNewIds,
        brandId,
        session,
      );
    }
  }

  if (keptDocs.length + addedSubBrands.length === 0) {
    throwError(400, "At least one SubBrand is required.");
  }

  return { keptDocs, addedSubBrands };
};

const buildSubBrandMapping = ({
  userId,
  voucherId,
  versionId,
  brandId,
  item,
}) => ({
  createdBy: userId,
  updatedBy: userId,
  voucherId,
  voucherVersionId: versionId,
  brandId,
  subBrandId: item.subBrandId || item._id,
  geo: item.geo,
  locationId: item.locationId,
  subBrandName: item.subBrandName,
  storeId: item.storeId,
  isActive: true,
  isDeleted: false,
});

exports.updateVoucher = async (userId, payload = {}, images) => {
  const session = await mongoose.startSession();
  let uploadedImages = [];
  let removedImagesToDelete = [];
  try {
    session.startTransaction();

    const voucher = await Voucher.findOne({
      _id: payload.voucherId,
      isDeleted: false,
      isActive: true,
    }).session(session);

    if (!voucher) throwError(404, "Voucher not found.");

    // if (String(voucher.createdBy) !== String(userId)) {
    //   throwError(403, "You are not authorized to update this voucher.");
    // }

    if (!voucher.currentVersionId) {
      throwError(400, "Voucher has no editable version.");
    }

    const currentVersion = await VoucherVersion.findOne({
      _id: voucher.currentVersionId,
      voucherId: voucher._id,
      isDeleted: false,
      isActive: true,
    })
      .session(session)
      .lean();

    if (!currentVersion) throwError(404, "Voucher current version not found.");

    const { maxOffers, maxImages } = await getVoucherConfig();

    if (currentVersion.status === VOUCHER_STATUSES.UNDER_REVIEW) {
      throwError(409, "Voucher is under review and cannot be edited.");
    }
    if (currentVersion.status === VOUCHER_STATUSES.ARCHIVED) {
      throwError(409, "Archived voucher cannot be edited.");
    }
    if (currentVersion.status === VOUCHER_STATUSES.PAUSED) {
      throwError(
        409,
        "Paused voucher cannot be edited directly. Resume it first.",
      );
    }
    if (currentVersion.status === VOUCHER_STATUSES.EXPIRED) {
      throwError(409, "Expired voucher cannot be edited.");
    }

    const needsNewVersion =
      currentVersion.isImmutable ||
      currentVersion.status === VOUCHER_STATUSES.PUBLISHED ||
      currentVersion.status === VOUCHER_STATUSES.APPROVED;

    if (
      !needsNewVersion &&
      ![VOUCHER_STATUSES.DRAFT, VOUCHER_STATUSES.REJECTED].includes(
        currentVersion.status,
      )
    ) {
      throwError(
        409,
        `Voucher cannot be edited from ${currentVersion.status} status.`,
      );
    }

    const name =
      payload.name !== undefined
        ? String(payload.name).trim()
        : currentVersion.name;
    if (!name) throwError(400, "Voucher name cannot be empty.");
    const normalizedName = name.trim().toLowerCase();

    if (payload.name !== undefined) {
      const duplicateVoucher = await Voucher.findOne({
        _id: { $ne: voucher._id },
        brandId: voucher.brandId,
        normalizedName,
        isDeleted: false,
      })
        .session(session)
        .select("_id");
      if (duplicateVoucher) {
        throwError(
          409,
          "Voucher with this name already exists for this brand.",
        );
      }
    }

    const description =
      payload.description !== undefined
        ? payload.description
        : currentVersion.description;

    let startAt = currentVersion.startAt;
    let endAt = currentVersion.endAt;
    if (payload.startAt !== undefined || payload.endAt !== undefined) {
      const dates = validateVoucherDates(
        payload.startAt ?? currentVersion.startAt,
        payload.endAt ?? currentVersion.endAt,
        { requireFuture: true },
      );
      startAt = dates.startAt;
      endAt = dates.endAt;
    }

    const tags = mergeTags(
      currentVersion.tags,
      payload.newTags,
      payload.removedTags,
    );

    const offers = mergeOffers(
      currentVersion.offers,
      payload.newOffers,
      payload.removedOfferIds,
      maxOffers,
    );

    const voucherFiles = normalizeVoucherImages(images);
    validateVoucherImages(voucherFiles, maxImages);
    if (voucherFiles.length) {
      uploadedImages = await uploadVoucherImages(voucherFiles);
    }

    const { finalImages, removedImages } = mergeImages(
      currentVersion.images,
      uploadedImages,
      payload.removeImageIds,
      maxImages,
    );

    const existingSubBrandDocs = await VoucherSubBrand.find({
      voucherId: voucher._id,
      voucherVersionId: currentVersion._id,
      isActive: true,
      isDeleted: false,
    })
      .session(session)
      .lean();

    const { keptDocs, addedSubBrands } = await mergeSubBrands({
      existingSubBrandDocs,
      newSubBrandIds: payload.newSubBrandIds,
      removeSubBrandIds: payload.removeSubBrandIds,
      brandId: voucher.brandId,
      session,
    });

    let targetVersion;
    let versionCreated = false;

    if (needsNewVersion) {
      // Published/approved version is immutable history — fork a new draft
      // version instead of mutating it. Removed images are simply excluded
      // from the clone (never physically deleted) since the old version
      // still references them.
      const versionNumber = await getNextVersionNumber(voucher._id, session);
      const versionCode = generateVoucherVersionCode(
        voucher.voucherCode,
        versionNumber,
      );

      const [newVersion] = await VoucherVersion.create(
        [
          {
            createdBy: userId,
            voucherId: voucher._id,
            brandId: voucher.brandId,
            versionNumber,
            versionCode,
            name,
            description,
            tags,
            categoryId: currentVersion.categoryId,
            subCategoryId: currentVersion.subCategoryId,
            images: finalImages,
            offers,
            startAt,
            endAt,
            status: VOUCHER_STATUSES.DRAFT,
            isImmutable: false,
            isActive: true,
          },
        ],
        { session },
      );
      targetVersion = newVersion;
      versionCreated = true;

      const subBrandDocs = [
        ...keptDocs.map((item) =>
          buildSubBrandMapping({
            userId,
            voucherId: voucher._id,
            versionId: targetVersion._id,
            brandId: voucher.brandId,
            item,
          }),
        ),
        ...addedSubBrands.map((item) =>
          buildSubBrandMapping({
            userId,
            voucherId: voucher._id,
            versionId: targetVersion._id,
            brandId: voucher.brandId,
            item,
          }),
        ),
      ];

      if (subBrandDocs.length) {
        await VoucherSubBrand.insertMany(subBrandDocs, { session });
      }

      const masterUpdate = await Voucher.updateOne(
        {
          _id: voucher._id,
          currentVersionId: currentVersion._id,
          isDeleted: false,
        },
        {
          $set: {
            currentVersionId: targetVersion._id,
            currentVersion: versionNumber,
            status: VOUCHER_STATUSES.DRAFT,
            name,
            normalizedName,
            updatedBy: userId,
          },
        },
        { session },
      );

      if (masterUpdate.modifiedCount !== 1) {
        throwError(
          409,
          "Voucher was modified by another request. Please refresh and try again.",
        );
      }

      await createVoucherHistory({
        voucher,
        version: targetVersion,
        action: VOUCHER_APPROVAL_ACTION.SUBMITTED,
        performedBy: userId,
        reason: "New editable voucher version created from published version.",
        metadata: {
          event: "VERSION_CREATED",
          sourceVersionId: currentVersion._id,
          sourceVersionNumber: currentVersion.versionNumber,
          sourceVersionStatus: currentVersion.status,
          newVersionId: targetVersion._id,
          newVersionNumber: targetVersion.versionNumber,
          changedFields: Object.keys(payload),
        },
        session,
      });
    } else {
      targetVersion = currentVersion;

      const updateData = {
        name,
        description,
        tags,
        offers,
        images: finalImages,
        startAt,
        endAt,
      };

      if (currentVersion.status === VOUCHER_STATUSES.REJECTED) {
        updateData.status = VOUCHER_STATUSES.DRAFT;
        updateData.rejectionReason = null;
        updateData.rejectedBy = null;
        updateData.rejectedAt = null;
        updateData.reviewedBy = null;
        updateData.reviewedAt = null;
        updateData.submittedBy = null;
        updateData.submittedAt = null;
      }

      const versionUpdate = await VoucherVersion.updateOne(
        {
          _id: targetVersion._id,
          voucherId: voucher._id,
          status: { $in: [VOUCHER_STATUSES.DRAFT, VOUCHER_STATUSES.REJECTED] },
          isImmutable: false,
          isDeleted: false,
        },
        { $set: updateData },
        { session },
      );

      if (versionUpdate.modifiedCount !== 1) {
        throwError(
          409,
          "Voucher version was modified by another request. Please refresh and try again.",
        );
      }

      if (payload.removeSubBrandIds?.length) {
        await VoucherSubBrand.updateMany(
          {
            voucherId: voucher._id,
            voucherVersionId: targetVersion._id,
            subBrandId: { $in: payload.removeSubBrandIds },
            isDeleted: false,
          },
          {
            $set: { isActive: false, isDeleted: true, updatedBy: userId },
          },
          { session },
        );
      }

      if (addedSubBrands.length) {
        const newMappings = addedSubBrands.map((item) =>
          buildSubBrandMapping({
            userId,
            voucherId: voucher._id,
            versionId: targetVersion._id,
            brandId: voucher.brandId,
            item,
          }),
        );
        await VoucherSubBrand.insertMany(newMappings, { session });
      }

      const masterUpdate = { updatedBy: userId };
      if (payload.name !== undefined) {
        masterUpdate.name = name;
        masterUpdate.normalizedName = normalizedName;
      }
      if (updateData.status) masterUpdate.status = updateData.status;

      await Voucher.updateOne(
        { _id: voucher._id, isDeleted: false },
        { $set: masterUpdate },
        { session },
      );

      // Draft/rejected images belong only to this version, so removed ones
      // can be deleted for real (unlike the forked-version case above).
      removedImagesToDelete = removedImages;

      await createVoucherHistory({
        voucher,
        version: targetVersion,
        action: VOUCHER_APPROVAL_ACTION.SUBMITTED,
        performedBy: userId,
        reason: "Voucher version updated.",
        metadata: {
          event: "VERSION_UPDATED",
          versionNumber: targetVersion.versionNumber,
          changedFields: Object.keys(payload),
        },
        session,
      });
    }

    const finalVersion = await VoucherVersion.findOne({
      _id: targetVersion._id,
    })
      .session(session)
      .lean();

    await session.commitTransaction();

    if (removedImagesToDelete.length) {
      await rollbackVoucherImages(removedImagesToDelete);
    }

    return {
      voucherId: voucher._id,
      voucherCode: voucher.voucherCode,
      versionId: finalVersion._id,
      versionCode: finalVersion.versionCode,
      versionNumber: finalVersion.versionNumber,
      status: finalVersion.status,
      currentVersionId: finalVersion._id,
      publishedVersionId: voucher.publishedVersionId,
      versionCreated,
    };
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    if (uploadedImages.length) await rollbackVoucherImages(uploadedImages);
    if (error?.code === 11000) {
      throwError(
        409,
        "Voucher with the same name already exists for this brand.",
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};
