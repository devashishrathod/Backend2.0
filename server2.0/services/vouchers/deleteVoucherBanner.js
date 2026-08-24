const Voucher = require("../../models/Voucher");
const { throwError } = require("../../utils");
const { resolveActorBrand } = require("../../helpers/brands");
const { VOUCHER_BANNER_MEDIA_FIELD } = require("../../constants/voucherBanner");
const { deleteVoucherBannerMedia } = require("../../helpers/vouchers");

// Removes the voucher's independent promo banner. Never touches
// status/approval/versions.
exports.deleteVoucherBanner = async (actor, voucherId) => {
  const userId = actor.userId;
  const voucher = await Voucher.findOne({ _id: voucherId, isDeleted: false });
  if (!voucher) throwError(404, "Voucher not found.");

  // The endpoint took a voucherId with no ownership check at all, so any
  // authenticated caller could change any brand's banner.
  await resolveActorBrand(actor, voucher.brandId);

  const currentType = voucher.banner?.type || null;
  if (!currentType) throwError(404, "This voucher has no banner to delete.");

  const field = VOUCHER_BANNER_MEDIA_FIELD[currentType];
  const media = voucher.banner[field]?.toObject?.() ?? voucher.banner[field];

  voucher.banner = { type: null };
  voucher.updatedBy = userId;
  await voucher.save();

  await deleteVoucherBannerMedia(currentType, media);
};
