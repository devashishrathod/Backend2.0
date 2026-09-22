const Brand = require("../../models/Brand");
const { buildAggregateLookup } = require("../../database");
const { pagination } = require("../../utils");
const { SYSTEM_VERIFICATION_STATUS } = require("../../constants");
const {
  customerVisibleBrandFilter,
  outletDistanceExpression,
} = require("../brands");
// By file, not the barrel — same reason `buildBrandPlanLookup` is required that
// way below.
const {
  buildBrandRelationshipMap,
  brandRelationshipFor,
} = require("../brands/brandRelationship");
const {
  SEARCH_RESULT_TYPES,
  SEARCH_TARGET_SCREENS,
} = require("../../constants/search");
// By file, not the barrel — see the note in `helpers/vouchers/customerListing.js`.
const { buildBrandPlanLookup } = require("../subscribeds/brandPlanLookup");
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
const toItem = (row, relationship) => {
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
      merchantId: row.merchantId || null,
      subscriptionPlan: row.subscriptionPlan || null,
      isTopBrand: row.isTopBrand ?? false,
      isVerified: row.isVerified ?? false,
      followersCount: row.followersCount ?? 0,
      // Beside `followersCount`, which is where every other brand surface puts
      // them. Both are always present — a guest gets `false`, not a missing key.
      isFollowed: relationship?.isFollowed ?? false,
      isAvoided: relationship?.isAvoided ?? false,
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
  // Already an ObjectId, or `null` for a guest — `globalSearch` normalises it
  // once for every section.
  customerId,
}) => {
  const pipeline = [
    {
      // ⚠️ Verified only — search must not surface a brand the directory
      // hides, or a customer finds by searching what they cannot find by
      // browsing. `customerVisibleBrandFilter` is the shared definition.
      $match: customerVisibleBrandFilter({ brandName: searchRegex(term) }),
    },
    // Narrow before the joins — each lookup below runs once per surviving row.
    {
      $project: {
        brandName: 1,
        logo: 1,
        uniqueId: 1,
        merchantId: 1,
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
        // ⚠️ The comment here claimed `isApproved` is never written. It is —
        // `reviewBrandVerification` writes it on all three actions — and the
        // `$match` above now requires it. The badge still reads `SystemVerify`,
        // which carries the verdict's history.
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
    // The live plan, after the `$sort` so it joins on rows already in their
    // final order. Same key the brand listing and the voucher feed use.
    ...buildBrandPlanLookup({ localField: "_id", as: "subscriptionPlan" }),
    {
      $project: {
        brandName: 1,
        logo: 1,
        uniqueId: 1,
        merchantId: 1,
        subscriptionPlan: 1,
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

  /**
   * The viewer's own follow / avoid state, over the rows this page returned.
   *
   * After paging, not a `$lookup`: a search box answers while the customer is
   * still typing, and joining two collections per matched brand before `$limit`
   * is exactly the cost this section cannot pay. Two indexed `$in` reads over at
   * most `limit` ids is flat. A guest resolves to nothing and skips both.
   */
  const relationships = await buildBrandRelationshipMap(
    customerId,
    result.data.map((row) => row._id),
  );

  return {
    total: result.total,
    totalPages: result.totalPages,
    items: result.data.map((row) =>
      toItem(row, brandRelationshipFor(relationships, row._id)),
    ),
    seeAll: {
      endpoint: "/brands/customer/get-all",
      params: { search: term },
    },
  };
};
