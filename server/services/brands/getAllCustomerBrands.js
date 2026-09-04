const mongoose = require("mongoose");
const Brand = require("../../models/Brand");
const { buildAggregateLookup } = require("../../database");
const { SYSTEM_VERIFICATION_STATUS } = require("../../constants");
const { pagination } = require("../../utils");
const { escapeRegex } = require("../../validator/common");
// Shared with the global search's brand section — see the note in that file
// for why the formula lives in one place.
const { outletDistanceExpression } = require("../../helpers/brands");

/**
 * The customer-facing brand directory, and the "Top Brands" tab.
 *
 * One endpoint serves both. `topOnly` narrows to the curated picks; without it
 * the listing returns everything with those picks leading. Keeping that as one
 * sorted set — rather than a pinned list concatenated onto a second query — is
 * what lets "view more" page cleanly: the top brands lead page 1 and then
 * simply do not reappear.
 *
 * Deliberately lighter than `getCustomerBrand`. A list card does not need
 * features, showcase or per-outlet detail, and this runs over every brand
 * rather than one.
 *
 * Geo is optional (Q6). With coordinates each row carries `distanceInMeters`
 * and `DISTANCE` sorting becomes available; without them this is a plain
 * directory that does no geo work at all.
 */
exports.getAllCustomerBrands = async (query) => {
  const {
    page = 1,
    limit = 10,
    search,
    categoryId,
    subCategoryId,
    topOnly,
    sortBy = "TOP_FIRST",
    sortOrder,
  } = query;

  const latitude = Number(query.latitude);
  const longitude = Number(query.longitude);
  const hasGeo = Number.isFinite(latitude) && Number.isFinite(longitude);

  const pipeline = [];

  // ── Match ─────────────────────────────────────────────────────────────────
  const match = { isDeleted: false, isActive: true };
  if (topOnly) match.isTopBrand = true;
  if (categoryId) match.categoryId = new mongoose.Types.ObjectId(categoryId);
  if (subCategoryId) {
    match.subCategoryId = new mongoose.Types.ObjectId(subCategoryId);
  }
  if (search?.trim()) {
    match.brandName = { $regex: escapeRegex(search.trim()), $options: "i" };
  }

  pipeline.push({ $match: match });

  // Narrow before the joins — the lookups below run once per surviving row.
  pipeline.push({
    $project: {
      brandName: 1,
      description: 1,
      logo: 1,
      coverImage: 1,
      uniqueId: 1,
      followersCount: 1,
      joinedDate: 1,
      // Older brands predate these fields, so a missing value must read as
      // "not curated" rather than sort unpredictably.
      isTopBrand: { $ifNull: ["$isTopBrand", false] },
      topOrder: { $ifNull: ["$topOrder", 0] },
      categoryId: 1,
      subCategoryId: 1,
      systemVerifyId: 1,
    },
  });

  // ── Joins ─────────────────────────────────────────────────────────────────
  pipeline.push(
    ...buildAggregateLookup({
      from: "categories",
      localField: "categoryId",
      as: "category",
      project: { name: 1, image: 1 },
    }),
    ...buildAggregateLookup({
      from: "subcategories",
      localField: "subCategoryId",
      as: "subCategory",
      project: { name: 1, image: 1 },
    }),
    // Only the verdict — never the scores, flags or duplicate-brand id lists
    // SystemVerify also carries.
    ...buildAggregateLookup({
      from: "systemverifies",
      localField: "systemVerifyId",
      as: "verification",
      project: { status: 1 },
    }),
  );

  // Outlets — a count on every row, plus the nearest one's distance when the
  // caller supplied coordinates.
  pipeline.push({
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
  });

  pipeline.push({
    $addFields: {
      outletCount: { $size: "$outlets" },
      // `Brand.isApproved` is never written anywhere in the codebase, so the
      // real verdict lives on the SystemVerify document.
      isVerified: {
        $eq: ["$verification.status", SYSTEM_VERIFICATION_STATUS.APPROVED],
      },
      ...(hasGeo
        ? {
            // A brand is as near as its nearest outlet. Outlets without
            // coordinates are dropped rather than counted as distance 0.
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
  });

  // ── Sort ──────────────────────────────────────────────────────────────────
  const sortStage = {};

  // Curated picks lead whatever ordering follows — except on the tab itself,
  // where every row is already curated and only their relative order matters.
  if (topOnly) {
    sortStage.topOrder = 1;
  } else {
    sortStage.isTopBrand = -1;
    sortStage.topOrder = 1;
  }

  if (sortBy === "NEWEST") {
    sortStage.joinedDate = sortOrder === "asc" ? 1 : -1;
  } else if (sortBy === "FOLLOWERS") {
    sortStage.followersCount = sortOrder === "asc" ? 1 : -1;
  } else if (sortBy === "NAME") {
    sortStage.brandName = sortOrder === "desc" ? -1 : 1;
  } else if (sortBy === "DISTANCE" && hasGeo) {
    sortStage.nearestDistance = sortOrder === "desc" ? -1 : 1;
  } else {
    // TOP_FIRST, and the fallback when DISTANCE was asked for without
    // coordinates: newest brands after the curated block.
    sortStage.joinedDate = -1;
  }

  // Ties would otherwise page unpredictably — the same brand could appear on
  // two pages while another never appears at all.
  sortStage._id = 1;

  pipeline.push({ $sort: sortStage });

  pipeline.push({
    $project: {
      brandName: 1,
      description: 1,
      logo: 1,
      coverImage: 1,
      uniqueId: 1,
      followersCount: 1,
      joinedDate: 1,
      isTopBrand: 1,
      isVerified: 1,
      category: 1,
      subCategory: 1,
      outletCount: 1,
      ...(hasGeo
        ? { distanceInMeters: { $round: ["$nearestDistance", 0] } }
        : {}),
    },
  });

  return pagination(Brand, pipeline, page, limit, "brand");
};
