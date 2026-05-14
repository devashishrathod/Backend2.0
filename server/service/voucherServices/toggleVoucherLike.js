const FavoriteVoucher = require("../../model/FavoriteVoucher");
const Voucher = require("../../model/Voucher");
const { throwError } = require("../../utils");

exports.toggleVoucherLike = async (userId, voucherId) => {
  const voucher = await Voucher.findOne({
    _id: voucherId,
    isDeleted: false,
    isActive: true,
  });
  if (!voucher) throwError(404, "Voucher not found.");
  const existing = await FavoriteVoucher.findOne({
    user: userId,
    voucher: voucherId,
  });
  if (existing && !existing.isDeleted) {
    await FavoriteVoucher.updateOne({ _id: existing._id }, { isDeleted: true });
    return { liked: false };
  }
  if (existing && existing.isDeleted) {
    await FavoriteVoucher.updateOne(
      { _id: existing._id },
      { isDeleted: false }
    );
    return { liked: true };
  }
  await FavoriteVoucher.create({ user: userId, voucher: voucherId });
  return { liked: true };
};
