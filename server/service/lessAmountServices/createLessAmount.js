const { OFFERS_SCOPE } = require("../../constants");
const LessAmount = require("../../model/LessAmount");
const Voucher = require("../../model/Voucher");
const { generateUniqueLessAmountId } = require("./generateUniqueLessAmountId");

exports.createLessAmount = async (data) => {
  let { voucher, validFrom, validTill, isActive, scope, users } = data;
  const linkedVoucher = await Voucher.findById(voucher);
  if (!linkedVoucher) {
    const error = new Error("Voucher not found");
    error.statusCode = 404;
    throw error;
  }
  if (
    new Date(validFrom) < new Date(voucher.validFrom) ||
    new Date(validTill) > new Date(voucher.validTill)
  ) {
    const error = new Error(
      "LessAmount valid dates must lie within voucher's valid date range"
    );
    error.statusCode = 400;
    throw error;
  }
  const now = new Date();
  isActive = now >= new Date(data.validFrom) && now <= new Date(data.validTill);
  const finalUsers = scope === OFFERS_SCOPE.ALL_USERS ? [] : users;

  const payload = {
    voucher,
    validFrom,
    validTill,
    isActive,
    scope,
    users: finalUsers,
    uniqueId: await generateUniqueLessAmountId(),
    ...data,
  };
  return await LessAmount.create(payload);
};
