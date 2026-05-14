const SubBrand = require("../../model/SubBrand");
const Voucher = require("../../model/Voucher");
const { VOUCHER_STATUS, PLATFORMS } = require("../../constants");
const { getBrandById } = require("../brandServices");
const { createImage } = require("../../service/imageServices");
const {
  validateVoucherDatesAndStatus,
  determineIsActive,
  generateUniqueVoucherId,
} = require("../../helpers/vouchers");

exports.addVoucher = async (voucherData, userId, brandId, brandUserId) => {
  let {
    images,
    title,
    description,
    publishedDate,
    validFrom,
    validTill,
    status,
    subBrandIds,
    ...rest
  } = voucherData;
  const brandDetails = await getBrandById(brandId);
  if (!brandDetails) {
    throw { statusCode: 404, message: "Brand not found" };
  }
  const subBrandsArray = Array.isArray(subBrandIds)
    ? subBrandIds
    : [subBrandIds];
  const finalPublishedDate = publishedDate ? new Date(publishedDate) : null;
  const dateError = validateVoucherDatesAndStatus(
    status,
    finalPublishedDate,
    validFrom,
    validTill,
  );
  if (dateError) {
    throw { statusCode: 400, message: dateError };
  }
  const isActive = determineIsActive(status);
  const isPublished =
    status === VOUCHER_STATUS.ACTIVE ||
    status === VOUCHER_STATUS.EXPIRED ||
    status === VOUCHER_STATUS.USED_UP;

  const voucher = await Voucher.create({
    ...rest,
    user: brandUserId,
    brand: brandId,
    createdBy: userId,
    category: brandDetails?.category,
    subCategory: brandDetails?.subCategory,
    subBrands: subBrandsArray,
    title: title?.toLowerCase(),
    description: description?.toLowerCase(),
    status,
    publishedDate,
    validFrom,
    validTill,
    isActive,
    isPublished,
    uniqueId: await generateUniqueVoucherId(),
  });

  const imageDataArray = Array.isArray(images) ? images : [images];
  const createdImages = await Promise.all(
    imageDataArray.map((img) =>
      createImage({
        voucher: voucher._id,
        imageUrl: img.imageUrl,
        filename: img.filename,
        size: img.size,
        mime: img.mime,
        type: PLATFORMS.ANDROID,
      }),
    ),
  );
  const newImageIds = createdImages.map((img) => img._id);
  voucher.images = newImageIds;
  await voucher.save();

  if (voucher && subBrandsArray.length > 0) {
    await SubBrand.updateMany(
      { _id: { $in: subBrandsArray } },
      { $addToSet: { vouchers: voucher._id } },
    );
  }
  return voucher;
};
