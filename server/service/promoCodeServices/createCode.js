const PromoCode = require("../../model/PromoCode");
const Voucher = require("../../model/Voucher");
const { generateUniquePromoCodeId } = require("./generateUniquePromoCodeId");

exports.createCode = async (payload) => {
  const { voucher, validFrom, validTill } = payload;
  const linkedVoucher = await Voucher.findOne({
    _id: voucher,
    isDeleted: false,
  });
  if (!linkedVoucher) {
    const err = new Error("No valid voucher found for provided ID");
    err.statusCode = 404;
    throw err;
  }
  const minVoucherStart = linkedVoucher.validFrom;
  const maxVoucherEnd = linkedVoucher.validTill;
  let finalStart = validFrom ? new Date(validFrom) : minVoucherStart;
  if (finalStart < minVoucherStart) {
    const err = new Error(
      `validFrom cannot be earlier than voucher start date: ${minVoucherStart.toISOString()}`
    );
    err.statusCode = 422;
    throw err;
  }
  let finalEnd = validTill ? new Date(validTill) : maxVoucherEnd;
  if (finalEnd > maxVoucherEnd) {
    const err = new Error(
      `validTill cannot be later than voucher end date: ${maxVoucherEnd.toISOString()}`
    );
    err.statusCode = 422;
    throw err;
  }
  if (finalStart >= finalEnd) {
    const err = new Error("validFrom must be earlier than validTill");
    err.statusCode = 422;
    throw err;
  }
  const now = new Date();
  const isActive = now >= finalStart && now <= finalEnd;
  const newPromoCode = await PromoCode.create({
    ...payload,
    claimedUsers: payload.claimedUsers || [],
    validFrom: finalStart,
    validTill: finalEnd,
    uniqueId: await generateUniquePromoCodeId(),
    isActive,
  });
  return newPromoCode;
};
