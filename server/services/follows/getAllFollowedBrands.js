const Follow = require("../../models/Follow");
const { pagination } = require("../../utils");
const { buildAggregateLookup } = require("../../database");
const { resolveCustomerByUserId } = require("../../helpers/customers");
const { buildBrandPlanLookup } = require("../../helpers/subscribeds");
const { FOLLOW_SORT_BY } = require("../../constants/follow");

exports.getAllFollowedBrands = async (userId, query) => {
  const customer = await resolveCustomerByUserId(userId);

  const {
    page = 1,
    limit = 10,
    search,
    sortBy = FOLLOW_SORT_BY.CREATED_AT,
    sortOrder = "desc",
  } = query;

  const match = { followerId: customer._id, isDeleted: false };

  const pipeline = [
    { $match: match },
    { $sort: { [sortBy]: sortOrder === "asc" ? 1 : -1 } },
    ...buildAggregateLookup({
      from: "brands",
      localField: "followeeId",
      as: "brand",
      project: {
        brandName: 1,
        logo: 1,
        coverImage: 1,
        description: 1,
        followersCount: 1,
        merchantId: 1,
        uniqueId: 1,
        isActive: 1,
        isDeleted: 1,
      },
    }),
    { $match: { "brand.isDeleted": false } },
  ];

  if (search) {
    pipeline.push({
      $match: {
        $or: [
          { "brand.brandName": { $regex: new RegExp(search, "i") } },
          { "brand.uniqueId": { $regex: new RegExp(search, "i") } },
        ],
      },
    });
  }

  /**
   * Beside `brand.merchantId`, the same key every other customer surface uses.
   *
   * Pushed last, after the search filter, so the join runs only on rows that
   * survive it — the two `$lookup`s cost nothing on a brand the caller filtered
   * out. Keyed off `brand._id` rather than `followeeId` because by this point
   * the brand is the thing that matched.
   */
  pipeline.push(
    ...buildBrandPlanLookup({
      localField: "brand._id",
      as: "brand.subscriptionPlan",
    }),
  );

  pipeline.push({ $project: { __v: 0 } });

  return pagination(Follow, pipeline, page, limit, "followed brand");
};
