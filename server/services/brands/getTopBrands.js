const Brand = require("../../models/Brand");
const { buildAggregateLookup } = require("../../database");
const { pagination } = require("../../utils");

/**
 * The admin's view of the "Top Brands" list.
 *
 * Mirrors getSuggestedVouchers: everything the admin pinned, including brands
 * that have since been deactivated — those are exactly the rows they need to
 * see in order to unpin them. `isActive` on each row marks them.
 *
 * The customer-facing tab is `GET /brands/customer/get-all?topOnly=true`, which
 * does filter on `isActive`.
 */
exports.getTopBrands = async (query) => {
  const { page = 1, limit = 10 } = query;

  const pipeline = [
    { $match: { isTopBrand: true, isDeleted: false } },
    // Same order the customer sees, so the admin is arranging the real list.
    { $sort: { topOrder: 1, topAddedAt: -1, _id: 1 } },
    {
      $project: {
        brandName: 1,
        description: 1,
        logo: 1,
        coverImage: 1,
        uniqueId: 1,
        followersCount: 1,
        isActive: 1,
        topOrder: 1,
        topAddedAt: 1,
        categoryId: 1,
        topAddedBy: 1,
      },
    },
    ...buildAggregateLookup({
      from: "categories",
      localField: "categoryId",
      as: "category",
      project: { name: 1, image: 1 },
    }),
    ...buildAggregateLookup({
      from: "users",
      localField: "topAddedBy",
      as: "topAddedByUser",
      project: { name: 1, email: 1 },
    }),
  ];

  return pagination(Brand, pipeline, page, limit, "brand");
};
