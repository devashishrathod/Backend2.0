const Location = require("../../models/Location");
const { pagination } = require("../../utils");
const {
  SEARCH_RESULT_TYPES,
  SEARCH_TARGET_SCREENS,
} = require("../../constants/search");
const { matchRankExpression } = require("./matchRank");
const { searchRegex } = require("./searchTerm");

/**
 * Places, not things — "Andheri", "Koramangala".
 *
 * There is no outlet name to search: `SubBrand` carries a `storeId` and a
 * `locationId` and nothing a customer would type. So an area is derived from
 * the addresses of live outlets, grouped by city.
 *
 * An area has no detail page either. Tapping one hands the app a point, and the
 * app moves its own location there — every geo-driven screen (home feed,
 * voucher search) already runs on `$geoNear`, so they follow with no new filter,
 * no new pipeline and no `city` param anywhere.
 *
 * ⚠️ **`city` is free text.** Nobody normalises it on the way in, so "Andheri
 * West", "andheri west" and "Andheri  West" are three values. Lowercasing and
 * trimming folds the first two; the third — a double space — stays separate,
 * because Mongo's aggregation has no regex replace to collapse inner runs of
 * whitespace with. The search does not break: one place can simply appear as
 * two rows. The real fix is normalising addresses at write time, which is its
 * own job.
 */

const toItem = (row) => {
  const parts = [];
  if (row.state) parts.push(row.state);
  parts.push(`${row.outletCount} outlet${row.outletCount === 1 ? "" : "s"}`);
  parts.push(`${row.brandCount} brand${row.brandCount === 1 ? "" : "s"}`);

  return {
    type: SEARCH_RESULT_TYPES.AREA,
    /**
     * Synthetic — an area is a group, not a document. It exists so the app has
     * a stable list key. It must never be sent back to any endpoint as an id.
     */
    id: `${row._id.city}|${row._id.state}`,
    title: row.title || null,
    subtitle: parts.join(" · "),
    // Places have no picture of their own. Sending `null` rather than a stock
    // image keeps the app from rendering a card that looks like a brand.
    image: null,
    meta: {
      city: row.title || null,
      state: row.state || null,
      latitude: row.latitude,
      longitude: row.longitude,
      outletCount: row.outletCount,
      brandCount: row.brandCount,
    },
    target: {
      screen: SEARCH_TARGET_SCREENS.LOCATION_SWITCH,
      params: {
        latitude: row.latitude,
        longitude: row.longitude,
        label: row.title || null,
      },
    },
  };
};

exports.buildAreaSection = async ({ term, normalized, page = 1, limit }) => {
  const pipeline = [
    {
      $match: {
        // Outlet addresses only. Without this the same query would search
        // customers' home addresses, which are not places to browse.
        subBrandId: { $exists: true, $ne: null },
        isActive: true,
        isDeleted: false,
        city: searchRegex(term),
      },
    },
    {
      $lookup: {
        from: "subbrands",
        let: { subBrandId: "$subBrandId" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$_id", "$$subBrandId"] },
              isActive: true,
              isDeleted: false,
            },
          },
          { $project: { brandId: 1 } },
        ],
        as: "outlet",
      },
    },
    // Inner join on purpose — an address whose outlet has closed is not a place
    // with anything to offer.
    { $unwind: "$outlet" },
    {
      $lookup: {
        from: "brands",
        let: { brandId: "$outlet.brandId" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$_id", "$$brandId"] },
              isActive: true,
              isDeleted: false,
            },
          },
          { $project: { _id: 1 } },
        ],
        as: "brand",
      },
    },
    { $unwind: "$brand" },
    {
      $group: {
        _id: {
          city: { $toLower: { $trim: { input: { $ifNull: ["$city", ""] } } } },
          state: { $toLower: { $trim: { input: { $ifNull: ["$state", ""] } } } },
        },
        // The original casing, for display. Lowercase is a grouping key, not a
        // label — "andheri west" on a customer's screen looks like a bug.
        title: { $first: "$city" },
        state: { $first: "$state" },
        outletCount: { $sum: 1 },
        // Distinct — one brand with four outlets in an area is one brand.
        brandIds: { $addToSet: "$brand._id" },
        /**
         * The centroid of the area's outlets, not one outlet's pin.
         *
         * Taking the first outlet would make "Andheri West" mean one shop's
         * street, and a customer switching there would lose half the area's
         * offers off the edge of the 25 km radius.
         */
        latitude: { $avg: { $arrayElemAt: ["$geo.coordinates", 1] } },
        longitude: { $avg: { $arrayElemAt: ["$geo.coordinates", 0] } },
      },
    },
    {
      $addFields: {
        brandCount: { $size: "$brandIds" },
        matchRank: matchRankExpression("$title", normalized),
      },
    },
    { $sort: { matchRank: 1, outletCount: -1, title: 1 } },
    { $project: { brandIds: 0 } },
  ];

  const result = await pagination(Location, pipeline, page, limit, "area", {
    allowEmpty: true,
  });

  return {
    total: result.total,
    totalPages: result.totalPages,
    items: result.data.map(toItem),
    /**
     * Points back at this endpoint. Areas are the one type with no listing of
     * their own — see `docs/global_customer_search_plan.md` §5.
     */
    seeAll: {
      endpoint: "/search",
      params: { q: term, type: SEARCH_RESULT_TYPES.AREA },
    },
  };
};
