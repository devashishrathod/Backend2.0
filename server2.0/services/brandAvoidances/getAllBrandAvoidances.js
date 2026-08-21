const BrandAvoidance = require("../../models/BrandAvoidance");
const { pagination } = require("../../utils");
const { buildAggregateLookup } = require("../../database");
const { resolveCustomerByUserId } = require("../../helpers/customers");
const { BRAND_AVOIDANCE_SORT_BY } = require("../../constants/brandAvoidance");

exports.getAllBrandAvoidances = async (userId, query) => {
  const customer = await resolveCustomerByUserId(userId);

  const {
    page = 1,
    limit = 10,
    search,
    sortBy = BRAND_AVOIDANCE_SORT_BY.CREATED_AT,
    sortOrder = "desc",
  } = query;

  const match = { customerId: customer._id, isDeleted: false };

  const pipeline = [
    { $match: match },
    { $sort: { [sortBy]: sortOrder === "asc" ? 1 : -1 } },
    ...buildAggregateLookup({
      from: "brands",
      localField: "brandId",
      as: "brand",
      project: {
        brandName: 1,
        logo: 1,
        coverImage: 1,
        description: 1,
        followersCount: 1,
        avoidanceCount: 1,
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

  pipeline.push({ $project: { __v: 0 } });

  return pagination(BrandAvoidance, pipeline, page, limit, "avoided brand");
};
