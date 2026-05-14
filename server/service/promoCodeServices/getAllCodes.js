const PromoCode = require("../../model/PromoCode");

exports.getAllCodes = async (filters) => {
  const {
    page = 1,
    limit = 10,
    sortBy = "createdAt",
    sortOrder = "desc",
    promoCode,
    title,
    isActive,
    voucher,
    validFrom,
    validTill,
    maxDiscountValue,
    userLimit,
  } = filters;
  const query = { isDeleted: false };
  if (promoCode) query.promoCode = { $regex: promoCode, $options: "i" };
  if (title) query.title = { $regex: title, $options: "i" };
  if (isActive !== undefined) query.isActive = isActive === "true";
  if (voucher) query.voucher = voucher;
  if (maxDiscountValue) query.maxDiscountValue = Number(maxDiscountValue);
  if (userLimit) query.userLimit = Number(userLimit);
  if (validFrom) query.validFrom = { $gte: new Date(validFrom) };
  if (validTill) query.validTill = { $lte: new Date(validTill) };

  const skip = (Number(page) - 1) * Number(limit);
  const promoCodes = await PromoCode.find(query)
    .sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 })
    .skip(skip)
    .limit(Number(limit))
    .lean();
  const total = await PromoCode.countDocuments(query);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPage: Math.ceil(total / Number(limit)),
    promoCodes,
  };
};
