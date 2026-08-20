const PromotionalTicker = require("../../models/PromotionalTicker");
const { pagination } = require("../../utils");
const { TICKER_SORT_BY } = require("../../constants/promotionalTicker");

exports.getAllTickers = async (query) => {
  const {
    page = 1,
    limit = 10,
    search,
    isActive,
    fromDate,
    toDate,
    sortBy = TICKER_SORT_BY.DISPLAY_ORDER,
    sortOrder = "asc",
  } = query;

  const match = { isDeleted: false };
  if (typeof isActive !== "undefined") match.isActive = isActive;
  if (search) match.title = { $regex: new RegExp(search, "i") };
  if (fromDate || toDate) {
    match.createdAt = {};
    if (fromDate) match.createdAt.$gte = new Date(fromDate);
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      match.createdAt.$lte = end;
    }
  }

  const pipeline = [
    { $match: match },
    { $sort: { [sortBy]: sortOrder === "asc" ? 1 : -1 } },
  ];

  return pagination(
    PromotionalTicker,
    pipeline,
    page,
    limit,
    "promotional ticker",
  );
};
