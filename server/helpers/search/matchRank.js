const { SEARCH_MATCH_RANK } = require("../../constants/search");

/**
 * How well one field matched the search term, as an aggregation expression.
 *
 * Sorting on the raw match alone is not enough: a regex says yes or no, so
 * "Tony's Pizza Corner" and "Pizza Hut" arrive equal and whatever sorts second —
 * follower count, join date — decides. Somebody who typed "pizza" then finds the
 * brand they meant three rows down.
 *
 * Lower is better, so it drops straight into a `$sort` with `1`.
 *
 * @param {string} fieldPath  e.g. `"$brandName"`
 * @param {string} normalized lowercased, whitespace-collapsed search term
 */
exports.matchRankExpression = (fieldPath, normalized) => ({
  $switch: {
    branches: [
      {
        // `$toLower` on a missing field gives "", which can only be an exact
        // match for an empty term — and an empty term never reaches here.
        case: { $eq: [{ $toLower: { $ifNull: [fieldPath, ""] } }, normalized] },
        then: SEARCH_MATCH_RANK.EXACT,
      },
      {
        case: {
          $eq: [
            {
              $indexOfCP: [
                { $toLower: { $ifNull: [fieldPath, ""] } },
                normalized,
              ],
            },
            0,
          ],
        },
        then: SEARCH_MATCH_RANK.PREFIX,
      },
    ],
    // It matched the `$match` to get here, so anything left is a `contains`.
    default: SEARCH_MATCH_RANK.CONTAINS,
  },
});
