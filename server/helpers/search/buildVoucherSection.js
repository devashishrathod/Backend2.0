const SubBrand = require("../../models/SubBrand");
const { pagination } = require("../../utils");
const {
  SEARCH_RESULT_TYPES,
  SEARCH_TARGET_SCREENS,
} = require("../../constants/search");
const {
  buildCustomerVoucherPipeline,
  mapCustomerVoucherListItem,
} = require("../vouchers");
const { getVoucherConfig } = require("../settings");

/**
 * Offers matching the search term, nearest first.
 *
 * Runs the **existing** customer voucher pipeline rather than a second one of
 * its own — SubBrand → VoucherSubBrand → published version → voucher → brand,
 * with the whole live-and-in-window rule already encoded. A parallel pipeline
 * would be one deploy away from showing a voucher in search that the listing
 * correctly hides.
 *
 * ⚠️ `sortBy` is left at its default (DISTANCE) rather than RELEVANCE, on
 * purpose. RELEVANCE scores through the `$text` index, and `$text` does **not**
 * prefix-match: a customer typing "piz" would get nothing until they finished
 * the word. The default branch uses a regex, which matches part-words — which
 * is exactly what a search box is for.
 *
 * ⚠️ This section is the only one that needs coordinates. `$geoNear` has to be
 * the first stage of a pipeline, so "search without a location" is not a filter
 * that can be dropped — it is a different pipeline. Rather than build one, a
 * caller with no location gets an honest empty section flagged
 * `locationRequired`, and the other four sections still answer.
 */

const toItem = (row) => {
  const outlet = row.nearestOutlet || {};
  // `formatDistance` returns { meters, kilometers, display } — the subtitle
  // wants the rendered string, and `meta` keeps the raw metres so the app can
  // sort or re-format without parsing "1.1 km" back apart.
  const distance = outlet.distance || null;

  const parts = [];
  if (row.brand?.brandName) parts.push(row.brand.brandName);
  if (outlet.location?.city) parts.push(outlet.location.city);
  if (distance?.display) parts.push(distance.display);

  return {
    type: SEARCH_RESULT_TYPES.VOUCHER,
    id: row.voucherId,
    title: row.name || null,
    subtitle: parts.join(" · ") || null,
    image: row.version?.images?.[0]?.url || null,
    meta: {
      brandId: row.brand?.id || null,
      brandName: row.brand?.brandName || null,
      categoryId: row.categoryId || null,
      subCategoryId: row.subCategoryId || null,
      bestOffer: row.version?.bestOffer || null,
      startAt: row.version?.startAt || null,
      endAt: row.version?.endAt || null,
      isSuggested: row.isSuggested ?? false,
      distance: distance?.display || null,
      distanceInMeters: distance?.meters ?? null,
    },
    target: {
      screen: SEARCH_TARGET_SCREENS.VOUCHER_DETAIL,
      endpoint: `/vouchers/customer/get/${row.voucherId}`,
    },
  };
};

exports.buildVoucherSection = async ({
  term,
  page = 1,
  limit,
  latitude,
  longitude,
  hasGeo,
}) => {
  if (!hasGeo) {
    return {
      total: 0,
      totalPages: 0,
      items: [],
      seeAll: null,
      // Not the same as "nothing matched". The app shows a prompt to turn
      // location on; an empty section with no reason reads as a broken feature.
      extra: { locationRequired: true },
    };
  }

  const config = await getVoucherConfig();
  const maxDistance = Number(config.maxDistanceKm) * 1000;

  const result = await pagination(
    SubBrand,
    buildCustomerVoucherPipeline({
      latitude,
      longitude,
      maxDistance,
      query: { search: term },
    }),
    page,
    limit,
    "voucher",
    // Nothing nearby matching the term is a normal answer, not a 404.
    { allowEmpty: true },
  );

  return {
    total: result.total,
    totalPages: result.totalPages,
    items: result.data.map(mapCustomerVoucherListItem).map(toItem),
    seeAll: {
      endpoint: "/vouchers/customer/get-all",
      params: { search: term, latitude, longitude },
    },
    extra: { locationRequired: false },
  };
};
