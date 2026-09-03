const VoucherVersion = require("../../models/VoucherVersion");
const VoucherSubBrand = require("../../models/VoucherSubBrand");
const VoucherApprovalHistory = require("../../models/VoucherApprovalHistory");
const { generateVoucherVersionCode } = require("./generateUniueCode");
const { throwError } = require("../../utils");
const { VOUCHER_STATUSES } = require("../../constants/voucher");

exports.getNextVersionNumber = async (voucherId, session) => {
  const lastVersion = await VoucherVersion.findOne({
    voucherId,
    isDeleted: false,
  })
    .sort({ versionNumber: -1 })
    .session(session)
    .select("versionNumber")
    .lean();
  return Number(lastVersion?.versionNumber || 0) + 1;
};

exports.cloneVoucherVersion = async ({
  voucher,
  sourceVersion,
  userId,
  session,
}) => {
  if (!sourceVersion) throwError(400, "Source voucher version not found.");

  const versionNumber = await exports.getNextVersionNumber(
    voucher._id,
    session,
  );

  const versionCode = generateVoucherVersionCode(
    voucher.voucherCode,
    versionNumber,
  );

  const clonedImages = (sourceVersion.images || []).map((image) => ({
    url: image.url,
    storage: image.storage
      ? {
          provider: image.storage.provider,
          publicId: image.storage.publicId,
          bucket: image.storage.bucket,
          key: image.storage.key,
        }
      : undefined,

    sortOrder: image.sortOrder,
    isActive: true,
    isDeleted: false,
  }));

  const clonedOffers = (sourceVersion.offers || []).map((offer) => ({
    title: offer.title,
    minBillAmount: offer.minBillAmount,
    discountType: offer.discountType,
    discountValue: offer.discountValue,
    maxDiscountAmount: offer.maxDiscountAmount,
    usageType: offer.usageType,
    discountApplicableOn: offer.discountApplicableOn,
    sortOrder: offer.sortOrder,
    isActive: true,
    isDeleted: false,
  }));

  const newVersion = new VoucherVersion({
    voucherId: voucher._id,
    versionNumber,
    versionCode,
    name: sourceVersion.name,
    description: sourceVersion.description,
    tags: Array.isArray(sourceVersion.tags) ? [...sourceVersion.tags] : [],
    categoryId: sourceVersion.categoryId,
    subCategoryId: sourceVersion.subCategoryId,
    images: clonedImages,
    offers: clonedOffers,
    startAt: sourceVersion.startAt,
    endAt: sourceVersion.endAt,
    status: VOUCHER_STATUSES.DRAFT,
    createdBy: userId,
    isImmutable: false,
    isActive: true,
    isDeleted: false,
  });

  await newVersion.save({ session });

  const subBrands = await VoucherSubBrand.find({
    voucherId: voucher._id,
    voucherVersionId: sourceVersion._id,
    isActive: true,
    isDeleted: false,
  })
    .session(session)
    .lean();

  if (subBrands.length) {
    const clonedSubBrands = subBrands.map((item) => ({
      createdBy: userId,
      updatedBy: userId,
      voucherId: voucher._id,
      voucherVersionId: newVersion._id,
      brandId: item.brandId,
      subBrandId: item.subBrandId,
      geo: item.geo,
      locationId: item.locationId,
      subBrandName: item.subBrandName,
      storeId: item.storeId,
      isActive: true,
      isDeleted: false,
    }));

    await VoucherSubBrand.insertMany(clonedSubBrands, { session });
  }
  return newVersion;
};

exports.createVoucherHistory = async ({
  voucher,
  version,
  action,
  performedBy,
  reason = null,
  metadata = null,
  session,
}) => {
  return VoucherApprovalHistory.create(
    [
      {
        voucherId: voucher._id,
        voucherVersionId: version._id,
        brandId: voucher.brandId,
        action,
        performedBy,
        versionNumber: version.versionNumber,
        voucherCode: voucher.voucherCode,
        versionCode: version.versionCode,
        reason,
        metadata,
      },
    ],
    { session },
  );
};
