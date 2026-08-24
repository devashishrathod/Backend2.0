const Voucher = require("../../models/Voucher");
const { throwError } = require("../../utils");
const { resolveActorBrand } = require("../../helpers/brands");
const { VOUCHER_BANNER_MEDIA_FIELD } = require("../../constants/voucherBanner");
const {
  uploadVoucherBannerMedia,
  deleteVoucherBannerMedia,
} = require("../../helpers/vouchers");

// Adds or replaces the voucher's independent promo banner. Never touches
// status/approval/versions — works regardless of the voucher's current
// version state.
exports.setVoucherBanner = async (actor, voucherId, bannerType, file) => {
  const userId = actor.userId;
  const voucher = await Voucher.findOne({ _id: voucherId, isDeleted: false });
  if (!voucher) throwError(404, "Voucher not found.");

  // The endpoint took a voucherId with no ownership check at all, so any
  // authenticated caller could change any brand's banner.
  await resolveActorBrand(actor, voucher.brandId);

  const field = VOUCHER_BANNER_MEDIA_FIELD[bannerType];
  if (!file) {
    throwError(422, `Please upload a ${field} file for the voucher banner.`);
  }

  const previousType = voucher.banner?.type || null;
  const previousField = previousType
    ? VOUCHER_BANNER_MEDIA_FIELD[previousType]
    : null;
  const previousMedia = previousField
    ? (voucher.banner[previousField]?.toObject?.() ??
      voucher.banner[previousField])
    : null;

  const newMedia = await uploadVoucherBannerMedia(bannerType, file);

  voucher.banner = { type: bannerType, [field]: newMedia };
  voucher.updatedBy = userId;

  try {
    await voucher.save();
  } catch (error) {
    await deleteVoucherBannerMedia(bannerType, newMedia);
    throw error;
  }

  if (previousType && previousMedia?.url) {
    await deleteVoucherBannerMedia(previousType, previousMedia);
  }

  return voucher;
};
