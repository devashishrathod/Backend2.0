const Voucher = require("../../models/Voucher");
const { throwError } = require("../../utils");
const { VOUCHER_BANNER_MEDIA_FIELD } = require("../../constants/voucherBanner");
const { deleteVoucherBannerMedia } = require("../../helpers/vouchers");

// Removes the voucher's independent promo banner. Never touches
// status/approval/versions.
exports.deleteVoucherBanner = async (userId, voucherId) => {
  const voucher = await Voucher.findOne({ _id: voucherId, isDeleted: false });
  if (!voucher) throwError(404, "Voucher not found.");

  const currentType = voucher.banner?.type || null;
  if (!currentType) throwError(404, "This voucher has no banner to delete.");

  const field = VOUCHER_BANNER_MEDIA_FIELD[currentType];
  const media = voucher.banner[field]?.toObject?.() ?? voucher.banner[field];

  voucher.banner = { type: null };
  voucher.updatedBy = userId;
  await voucher.save();

  await deleteVoucherBannerMedia(currentType, media);
};
