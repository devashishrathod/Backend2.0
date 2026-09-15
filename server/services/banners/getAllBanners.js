const Banner = require("../../models/Banner");
const { pagination } = require("../../utils");
const { BANNER_SORT_BY } = require("../../constants/banner");
const { toAdminBannerListShape } = require("../../helpers/banners");

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
  /**
   * ⚠️ The query parameter is still `type` — the panel's filter did not have to
   * change — but there is no `type` field to match against any more. It lands on
   * `media.kind`, which is where the answer moved.
   */
  if (type) match["media.kind"] = type;
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

  const result = await pagination(Banner, pipeline, page, limit, "banner");

  /**
   * ⚠️ Shaped after the aggregation, not inside it.
   *
   * A `$project` would have to name every field twice — once to keep it, once
   * to reach inside `media` — and the one it forgets is the one that leaks.
   * `toAdminBannerListShape` is the same whitelist the single read uses, so the
   * two cannot drift.
   */
  return { ...result, data: toAdminBannerListShape(result.data) };
};
