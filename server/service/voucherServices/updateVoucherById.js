const Voucher = require("../../model/Voucher");
const SubBrand = require("../../model/SubBrand");
const {
  validateVoucherDatesAndStatus,
  determineIsActive,
} = require("../../helpers/vouchers");
const { VOUCHER_STATUS } = require("../../constants");

exports.updateVoucherById = async (voucherId, data, updatedBy, brandUserId) => {
  const voucher = await Voucher.findOne({ _id: voucherId, isDeleted: false });
  if (!voucher) throw { statusCode: 404, message: "Voucher not found" };
  const {
    subBrandIds,
    status = voucher.status,
    publishedDate = voucher.publishedDate,
    validFrom = voucher.validFrom,
    validTill = voucher.validTill,
    ...rest
  } = data;
  if (status) {
    //   if (status === VOUCHER_STATUS.ACTIVE) {
    const error = validateVoucherDatesAndStatus(
      status,
      publishedDate,
      validFrom,
      validTill
    );
    if (error) throw { statusCode: 400, message: error };
  }
  const isActive = determineIsActive(status);
  const isPublished = [
    VOUCHER_STATUS.ACTIVE,
    VOUCHER_STATUS.EXPIRED,
    VOUCHER_STATUS.USED_UP,
  ].includes(status.toLowerCase());
  const incomingSubBrands = Array.isArray(subBrandIds)
    ? subBrandIds
    : subBrandIds
    ? [subBrandIds]
    : [];
  const existingSubBrands = voucher.subBrands.map((id) => id.toString());
  const toRemove = existingSubBrands.filter(
    (id) => !incomingSubBrands.includes(id)
  );
  if (toRemove.length > 0) {
    await SubBrand.updateMany(
      { _id: { $in: toRemove } },
      { $pull: { vouchers: voucher._id } }
    );
  }
  const toAdd = incomingSubBrands.filter(
    (id) => !existingSubBrands.includes(id)
  );
  if (toAdd.length > 0) {
    await SubBrand.updateMany(
      { _id: { $in: toAdd } },
      { $addToSet: { vouchers: voucher._id } }
    );
  }
  const updatedData = {
    ...rest,
    status,
    isActive,
    isPublished,
    validFrom,
    validTill,
    publishedDate,
    updatedBy,
    user: brandUserId,
    subBrands:
      incomingSubBrands.length > 0 ? incomingSubBrands : voucher.subBrands,
  };
  Object.assign(voucher, updatedData);
  await voucher.save();
  return voucher;
};
