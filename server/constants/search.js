/**
 * Global customer search — the shapes both the API and the app agree on.
 *
 * Every result row, whatever it is, carries `type` from `SEARCH_RESULT_TYPES`
 * and a `target` naming a screen from `SEARCH_TARGET_SCREENS`. The app renders
 * one row component for all five and routes on `target`, so a sixth type added
 * later needs no client change beyond a label.
 */

const SEARCH_RESULT_TYPES = Object.freeze({
  BRAND: "BRAND",
  VOUCHER: "VOUCHER",
  CATEGORY: "CATEGORY",
  SUB_CATEGORY: "SUB_CATEGORY",
  AREA: "AREA",
});

/**
 * Section order in the overview response.
 *
 * Brands first: a customer typing a name is usually after that brand, and the
 * one exact hit is worth more than twenty offers underneath it.
 */
const SEARCH_SECTION_ORDER = Object.freeze([
  SEARCH_RESULT_TYPES.BRAND,
  SEARCH_RESULT_TYPES.VOUCHER,
  SEARCH_RESULT_TYPES.CATEGORY,
  SEARCH_RESULT_TYPES.SUB_CATEGORY,
  SEARCH_RESULT_TYPES.AREA,
]);

const SEARCH_SECTION_LABELS = Object.freeze({
  [SEARCH_RESULT_TYPES.BRAND]: "Brands",
  [SEARCH_RESULT_TYPES.VOUCHER]: "Offers",
  [SEARCH_RESULT_TYPES.CATEGORY]: "Categories",
  [SEARCH_RESULT_TYPES.SUB_CATEGORY]: "Sub-categories",
  [SEARCH_RESULT_TYPES.AREA]: "Areas",
});

/**
 * Where tapping a row takes the customer.
 *
 * Sent by the server rather than derived by the app: the day a detail route
 * changes, it changes in one place instead of in every shipped app version.
 */
const SEARCH_TARGET_SCREENS = Object.freeze({
  BRAND_PROFILE: "BRAND_PROFILE",
  VOUCHER_DETAIL: "VOUCHER_DETAIL",
  CATEGORY_LISTING: "CATEGORY_LISTING",
  SUB_CATEGORY_LISTING: "SUB_CATEGORY_LISTING",
  // An area is not a page. The app moves its own location to the coordinates
  // on the row, and every geo-driven screen follows on its own.
  LOCATION_SWITCH: "LOCATION_SWITCH",
});

/**
 * Hard ceilings, separate from the admin-configurable defaults in
 * `constants/customer.js`. An admin can tune inside these; nobody can ask for a
 * page of five hundred rows.
 */
const SEARCH_LIMITS = Object.freeze({
  MAX_QUERY_LENGTH: 100,
  // Overview mode: rows per section.
  MAX_SECTION_LIMIT: 20,
  // Single-type mode: page size.
  MAX_TYPE_LIMIT: 50,
  MAX_POPULAR_QUERIES: 10,
  MAX_POPULAR_QUERY_LENGTH: 100,
});

/**
 * How well a row matched, best first. Written as numbers so a `$sort` can use
 * them directly — see `helpers/search/matchRank.js`.
 *
 * Without this an "exact" and a "contains" hit sort by whatever comes second,
 * and searching "pizza" puts "Tony's Pizza Corner" above "Pizza Hut".
 */
const SEARCH_MATCH_RANK = Object.freeze({
  EXACT: 0,
  PREFIX: 1,
  CONTAINS: 2,
});

module.exports = {
  SEARCH_RESULT_TYPES,
  SEARCH_SECTION_ORDER,
  SEARCH_SECTION_LABELS,
  SEARCH_TARGET_SCREENS,
  SEARCH_LIMITS,
  SEARCH_MATCH_RANK,
};
