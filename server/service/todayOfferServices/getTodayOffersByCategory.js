const TodayOffer = require("../../model/TodayOffer");

exports.getTodayOffersByCategory = async (
  categoryId,
  { page = 1, limit = 10, sortBy = "createdAt", sortOrder = "desc" }
) => {
  const now = new Date();
  const offers = await TodayOffer.find({
    dealOfCategory: categoryId,
    validFrom: { $lte: now },
    validTill: { $gte: now },
    isActive: true,
    isDeleted: false,
  }).populate({
    path: "vouchers",
    match: { isActive: true, isDeleted: false },
    populate: [
      { path: "brand", populate: { path: "location" } },
      { path: "subBrands" },
    ],
  });
  const allVouchers = offers.flatMap((offer) => offer.vouchers || []);
  const uniqueVouchersMap = new Map();
  allVouchers.forEach((v) => {
    if (v && v._id) uniqueVouchersMap.set(v._id.toString(), v);
  });
  let uniqueVouchers = Array.from(uniqueVouchersMap.values());
  uniqueVouchers.sort((a, b) => {
    const aValue = a[sortBy];
    const bValue = b[sortBy];
    if (sortOrder === "asc") return aValue > bValue ? 1 : -1;
    return aValue < bValue ? 1 : -1;
  });
  const total = uniqueVouchers.length;
  const start = (page - 1) * limit;
  const paginated = uniqueVouchers.slice(start, start + Number(limit));
  return {
    total,
    page: Number(page),
    limit: Number(limit),
    vouchers: paginated,
  };
};
