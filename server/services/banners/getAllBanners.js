const Banner = require("../../models/Banner");
const { pagination } = require("../../utils");
const { BANNER_SORT_BY } = require("../../constants/banner");

exports.getAllBanners = async (query) => {
  const {
    page = 1,
    limit = 10,
    search,
    type,
    isActive,
    fromDate,
    toDate,
    sortBy = BANNER_SORT_BY.CREATED_AT,
    sortOrder = "desc",
  } = query;

  const match = { isDeleted: false };
  if (type) match.type = type;
  if (typeof isActive !== "undefined") match.isActive = isActive;
  if (search) {
    match.$or = [
      { title: { $regex: new RegExp(search, "i") } },
      { description: { $regex: new RegExp(search, "i") } },
    ];
  }
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

  return pagination(Banner, pipeline, page, limit, "banner");
};
