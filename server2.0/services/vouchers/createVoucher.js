const mongoose = require("mongoose");
const Brand = require("../../models/Brand");
const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherSubBrand = require("../../models/VoucherSubBrand");
const { throwError } = require("../../utils");
const {
  normalizeVoucherName,
  getUniqueTags,
  validateVoucherCategory,
  validateVoucherSubCategory,
  validateVoucherSubBrands,
  validateVoucherValidityPeriod,
  normalizeVoucherImages,
  validateVoucherImages,
  uploadVoucherImages,
  rollbackVoucherImages,
  generateVoucherCode,
  generateVoucherVersionCode,
  uploadVoucherBannerMedia,
  deleteVoucherBannerMedia,
} = require("../../helpers/vouchers");
const {
  validateVoucherOffers,
  normalizeVoucherOffers,
} = require("../../helpers/voucherOffers");
const { VOUCHER_STATUSES } = require("../../constants/voucher");
const {
  VOUCHER_BANNER_MEDIA_FIELD,
  VOUCHER_BANNER_FILE_FIELD,
} = require("../../constants/voucherBanner");
const { getVoucherConfig } = require("../../helpers/settings");

exports.createVoucher = async (userId, payload, files = {}) => {
  const images = files?.images;
  const session = await mongoose.startSession();
  let uploadedImages = [];
  let uploadedBanner = null;
  try {
    session.startTransaction();
    let {
      brandId,
      name,
      description,
      tags,
      // usageType,
      // discountApplicableOn,
      startAt,
      endAt,
      offers,
      subBrandIds,
      isActive,
      isSaveAsDraft,
      bannerType,
    } = payload;
    const brand = await Brand.findById(brandId);
    if (!brand || brand.isDeleted) throwError(400, "Brand not found");

    const normalizedName = normalizeVoucherName(name);
    if (!normalizedName) throwError(400, "Voucher name is required.");

    const { categoryId, subCategoryId } = brand;
    const existingVoucher = await Voucher.findOne({
      brandId,
      normalizedName,
      isDeleted: false,
    })
      .session(session)
      .select("_id");

    if (existingVoucher) {
      throwError(409, "Voucher with this name already exists for this brand.");
    }

    await validateVoucherCategory(categoryId, session);
    await validateVoucherSubCategory(subCategoryId, categoryId, session);

    const subBrands = await validateVoucherSubBrands(
      subBrandIds,
      brandId,
      session,
    );

    const { maxOffers, maxImages } = await getVoucherConfig();
    validateVoucherOffers(offers, maxOffers);
    offers = normalizeVoucherOffers(offers);

    const validity = validateVoucherValidityPeriod(startAt, endAt);

    const voucherFiles = normalizeVoucherImages(images);
    if (!voucherFiles.length) {
      throwError(422, "At least one voucher image is required.");
    }
    validateVoucherImages(voucherFiles, maxImages);
    uploadedImages = await uploadVoucherImages(voucherFiles);

    tags = getUniqueTags(tags || []);

    const { voucherCode } = await generateVoucherCode(session);

    const [voucher] = await Voucher.create(
      [
        {
          createdBy: userId,
          brandId,
          name,
          normalizedName,
          description,
          voucherCode,
          categoryId,
          subCategoryId,
          tags,
          // usageType,
          // discountApplicableOn,
          startAt,
          endAt,
          isActive:
            typeof isActive === "string" ? isActive === "true" : isActive,
        },
      ],
      { session },
    );

    const versionNumber = 1;
    const versionCode = generateVoucherVersionCode(voucherCode, versionNumber);

    const [version] = await VoucherVersion.create(
      [
        {
          createdBy: userId,
          voucherId: voucher._id,
          brandId,
          versionNumber: 1,
          versionCode,
          name,
          description,
          tags,
          categoryId,
          subCategoryId,
          images: uploadedImages || [],
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

    if (bannerType) {
      const bannerField = VOUCHER_BANNER_MEDIA_FIELD[bannerType];
      const bannerFile = files?.[VOUCHER_BANNER_FILE_FIELD[bannerType]];
      uploadedBanner = await uploadVoucherBannerMedia(bannerType, bannerFile);
      voucher.banner = { type: bannerType, [bannerField]: uploadedBanner };
    }

    voucher.currentVersionId = version._id;
    voucher.currentVersion = versionNumber;
    await voucher.save({ session });

    const mappingDocuments = subBrands.map((subBrand) => ({
      createdBy: userId,
      brandId,
      voucherId: voucher._id,
      voucherVersionId: version._id,
      subBrandId: subBrand._id,
      geo: subBrand.geo,
      storeId: subBrand.storeId,
      locationId: subBrand.locationId,
      isActive: true,
      isDeleted: false,
    }));
    await VoucherSubBrand.insertMany(mappingDocuments, { session });

    await session.commitTransaction();
    return {
      voucherId: voucher._id,
      voucherCode: voucher.voucherCode,
      versionId: version._id,
      versionCode: version.versionCode,
      versionNumber,
      status: version.status,
    };
  } catch (error) {
    await session.abortTransaction();
    if (uploadedImages.length) await rollbackVoucherImages(uploadedImages);
    if (uploadedBanner) {
      await deleteVoucherBannerMedia(payload.bannerType, uploadedBanner);
    }
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
