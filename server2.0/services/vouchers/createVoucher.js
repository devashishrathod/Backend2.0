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
} = require("../../helpers/vouchers");
const {
  validateVoucherOffers,
  normalizeVoucherOffers,
} = require("../../helpers/voucherOffers");
const {
  VOUCHER_OFFER_LIMITS,
  VOUCHER_STATUSES,
} = require("../../constants/voucher");

exports.createVoucher = async (userId, payload, images) => {
  const session = await mongoose.startSession();
  let uploadedImages = [];
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

    // const maxOffersLimit = await getSetting()?.vouchers?.maxOffersPerVoucher  || 10
    validateVoucherOffers(offers, VOUCHER_OFFER_LIMITS.MAX_OFFERS); // 10   maxOffersLimit
    offers = normalizeVoucherOffers(offers);

    // const maxOffers = VOUCHER_OFFER_LIMITS.DEFAULT_MAX_OFFERS;
    const validity = validateVoucherValidityPeriod(startAt, endAt);

    const voucherFiles = normalizeVoucherImages(images);
    validateVoucherImages(voucherFiles, VOUCHER_OFFER_LIMITS.MAX_IMAGES); // 5
    if (voucherFiles.length) {
      uploadedImages = await uploadVoucherImages(voucherFiles);
    }

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
