const Brand = require("../../models/Brand");
const { buildAggregateLookup } = require("../../database");
const { pagination } = require("../../utils");
const { SYSTEM_VERIFICATION_STATUS } = require("../../constants");
const {
  SEARCH_RESULT_TYPES,
  SEARCH_TARGET_SCREENS,
} = require("../../constants/search");
const { outletDistanceExpression } = require("../brands");
const { matchRankExpression } = require("./matchRank");
const { searchRegex } = require("./searchTerm");

/**
 * Brands matching the search term.
 *
 * Matches `brandName` only, deliberately — not `description`. A long enough
 * description mentions half the platform's vocabulary, and one stray "pizza" in
 * an about-us paragraph does not make somebody a pizza brand. In a search box,
 * noise costs more than a missed edge case.
 */
const toItem = (row) => {
  const parts = [];
  if (row.category?.name) parts.push(row.category.name);
  if (row.outletCount) {
    parts.push(`${row.outletCount} outlet${row.outletCount === 1 ? "" : "s"}`);
  }

  return {
    type: SEARCH_RESULT_TYPES.BRAND,
    id: row._id,
    title: row.brandName || null,
    subtitle: parts.join(" · ") || null,
    image: row.logo || null,
    meta: {
      uniqueId: row.uniqueId || null,
      isTopBrand: row.isTopBrand ?? false,
      isVerified: row.isVerified ?? false,
      followersCount: row.followersCount ?? 0,
      outletCount: row.outletCount ?? 0,
      categoryId: row.categoryId || null,
      subCategoryId: row.subCategoryId || null,
      ...(row.distanceInMeters === undefined
        ? {}
        : { distanceInMeters: row.distanceInMeters }),
    },
    target: {
      screen: SEARCH_TARGET_SCREENS.BRAND_PROFILE,
      endpoint: `/brands/customer/get/${row._id}`,
    },
  };
};

exports.buildBrandSection = async ({
  term,
  normalized,
  page = 1,
  limit,
  latitude,
  longitude,
  hasGeo,
}) => {
  const pipeline = [
    {
      $match: {
        isActive: true,
        isDeleted: false,
        brandName: searchRegex(term),
      },
    },
    // Narrow before the joins — each lookup below runs once per surviving row.
    {
      $project: {
        brandName: 1,
        logo: 1,
        uniqueId: 1,
        followersCount: 1,
        categoryId: 1,
        subCategoryId: 1,
        systemVerifyId: 1,
        // Brands created before curation existed have neither field, and a
        // missing value must read as "not curated" rather than sort at random.
        isTopBrand: { $ifNull: ["$isTopBrand", false] },
        matchRank: matchRankExpression("$brandName", normalized),
      },
    },
    ...buildAggregateLookup({
      from: "categories",
      localField: "categoryId",
      as: "category",
      project: { name: 1 },
    }),
    // Only the verdict — never the scores or duplicate-brand id lists that
    // SystemVerify also carries.
    ...buildAggregateLookup({
      from: "systemverifies",
      localField: "systemVerifyId",
      as: "verification",
      project: { status: 1 },
    }),
    {
      $lookup: {
        from: "subbrands",
        let: { brandId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$brandId", "$$brandId"] },
              isActive: true,
              isDeleted: false,
            },
          },
          {
            $project: {
              _id: 1,
              ...(hasGeo
                ? { distance: outletDistanceExpression(latitude, longitude) }
                : {}),
            },
          },
        ],
        as: "outlets",
      },
    },
    {
      $addFields: {
        outletCount: { $size: "$outlets" },
        // `Brand.isApproved` is never written anywhere in the codebase, so the
        // real verdict lives on the SystemVerify document.
        isVerified: {
          $eq: ["$verification.status", SYSTEM_VERIFICATION_STATUS.APPROVED],
        },
        ...(hasGeo
          ? {
              // A brand is as near as its nearest outlet. Outlets with no
              // coordinates are dropped, not counted as zero.
              nearestDistance: {
                $min: {
                  $filter: {
                    input: "$outlets.distance",
                    as: "d",
                    cond: { $ne: ["$$d", null] },
                  },
                },
              },
            }
          : {}),
      },
    },
    {
      // How well it matched first, then curation, then popularity. `_id` last
      // so ties cannot page unpredictably — without it the same brand can show
      // up on two pages while another never appears.
      $sort: {
        matchRank: 1,
        isTopBrand: -1,
        followersCount: -1,
        _id: 1,
      },
    },
    {
      $project: {
        brandName: 1,
        logo: 1,
        uniqueId: 1,
        followersCount: 1,
        isTopBrand: 1,
        isVerified: 1,
        outletCount: 1,
        categoryId: 1,
        subCategoryId: 1,
        category: 1,
        ...(hasGeo
          ? { distanceInMeters: { $round: ["$nearestDistance", 0] } }
          : {}),
      },
    },
  ];

  // `allowEmpty` — nothing matching is a normal answer to a search, not a
  // missing resource. Without it `pagination` throws a 404 and one empty
  // section fails the whole request.
  const result = await pagination(Brand, pipeline, page, limit, "brand", {
    allowEmpty: true,
  });

  return {
    total: result.total,
    totalPages: result.totalPages,
    items: result.data.map(toItem),
    seeAll: {
      endpoint: "/brands/customer/get-all",
      params: { search: term },
    },
  };
};
