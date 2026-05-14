const Suggestion = require("../../model/SuggestionAds");
const Location = require("../../model/Location");
const { ROLES, OFFERS_SCOPE, VOUCHER_STATUS } = require("../../constants");
const { getUserById } = require("../userServices");
const { throwError } = require("../../utils");
const {
  toStringArray,
  buildRegionMatch,
  userProximityStages,
  projectStage,
} = require("../../helpers/suggestionAds/suggestion");

/**
 * Fetch suggestions with flexible filters + user-personalized sorting.
 * Pagination via page & limit.
 */
exports.getAllSuggestionAdsByUserLocation = async (userId, query) => {
  const user = await getUserById(userId);
  const role = user?.role || "GUEST";
  const userLocationId = user?.location;
  const userLocation = userLocationId
    ? await Location.findById(userLocationId).select("country state city")
    : null;
  const {
    countryCode,
    stateNames,
    stateCodes,
    cityNames,
    search,
    voucherId,
    scope,
    status,
    activeOnly,
    page = 1,
    limit = 10,
    sortBy,
    sortOrder = "desc",
  } = query;
  const _page = Math.max(parseInt(page) || 1, 1);
  const _limit = Math.min(Math.max(parseInt(limit) || 10, 1), 100);
  const _skip = (_page - 1) * _limit;
  const stateNamesArr = toStringArray(stateNames || query.stateName);
  const stateCodesArr = toStringArray(stateCodes || query.stateCode);
  const cityNamesArr = toStringArray(cityNames || query.cityName);
  const match = { isDeleted: false };
  const regionMatch = buildRegionMatch({
    countryCode,
    stateNames: stateNamesArr,
    stateCodes: stateCodesArr,
    cityNames: cityNamesArr,
  });
  if (Object.keys(regionMatch).length) Object.assign(match, regionMatch);
  if (search) {
    match.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }
  if (voucherId) match.voucher = voucherId;
  if (scope && Object.values(OFFERS_SCOPE).includes(scope)) match.scope = scope;
  if (status && Object.values(VOUCHER_STATUS).includes(status)) {
    match.status = status ? status : VOUCHER_STATUS.ACTIVE;
  }
  if (activeOnly === "true" || activeOnly === true) {
    const now = new Date();
    match.publishedDate = { $lte: now };
    match.endDate = { $gte: now };
  }
  const pipeline = [{ $match: match }];
  if (role === ROLES.USER) {
    const userCityName = userLocation?.city || null;
    const userStateName = userLocation?.state || null;
    pipeline.push(...userProximityStages({ userCityName, userStateName }));
  }
  if (role === ROLES.USER) {
    pipeline.push({
      $sort: { proximityScore: -1, publishedDate: -1, createdAt: -1 },
    });
  } else {
    const sort = {};
    if (sortBy) {
      sort[sortBy] = sortOrder === "asc" ? 1 : -1;
    } else {
      sort.publishedDate = -1;
      sort.createdAt = -1;
    }
    pipeline.push({ $sort: sort });
  }
  pipeline.push(
    {
      $lookup: {
        from: "vouchers",
        localField: "voucher",
        foreignField: "_id",
        as: "voucherData",
      },
    },
    { $unwind: { path: "$voucherData", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "brands",
        localField: "voucherData.brand",
        foreignField: "_id",
        as: "brandData",
      },
    },
    { $unwind: { path: "$brandData", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "locations",
        localField: "brandData.location",
        foreignField: "_id",
        as: "brandLocation",
      },
    },
    { $unwind: { path: "$brandLocation", preserveNullAndEmptyArrays: true } }
  );
  pipeline.push(
    projectStage(),
    {
      $facet: {
        docs: [{ $skip: _skip }, { $limit: _limit }],
        meta: [{ $count: "total" }],
      },
    },
    {
      $addFields: {
        total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
        page: _page,
        limit: _limit,
      },
    },
    {
      $project: { meta: 0 },
    }
  );
  const [result] = await Suggestion.aggregate(pipeline).allowDiskUse(true);
  const {
    docs = [],
    total = 0,
    page: curPage = _page,
    limit: curLimit = _limit,
  } = result || {};
  const totalPages = Math.ceil(total / curLimit) || 0;
  if (total === 0) throwError(404, "No suggestions found");
  return {
    total,
    page: curPage,
    limit: curLimit,
    totalPages,
    hasNextPage: curPage < totalPages,
    hasPrevPage: curPage > 1,
    suggestionAds: docs,
  };
};
