const { escapeRegex } = require("../../validator/common");

/**
 * Lowercase, with runs of whitespace collapsed to one space.
 *
 * Two things use this and both need the same answer: the `matchRank` comparison
 * inside the aggregations, and the `normalizedQuery` a history row dedupes on.
 * If they ever disagreed, a customer would see "Pizza" ranked as an exact match
 * and then find it saved as a second row next to "pizza".
 */
exports.normalizeQuery = (value = "") =>
  String(value).trim().replace(/\s+/g, " ").toLowerCase();

/**
 * A case-insensitive `contains` regex, safe for anything a customer can type.
 *
 * ⚠️ `escapeRegex` is not optional here. A search box accepts every character
 * on the keyboard, and `(` alone is an invalid pattern — Mongo throws and the
 * customer gets a 500 for typing a bracket. `.` and `*` are worse: they parse
 * fine and quietly match everything.
 */
exports.searchRegex = (value = "") =>
  new RegExp(escapeRegex(String(value).trim()), "i");

/**
 * The same term anchored to the start, for the ranking half of a match.
 *
 * Only this form can use an index on the field; the unanchored one always
 * scans. Both are needed — a customer searching "hut" expects "Pizza Hut".
 */
exports.searchPrefixRegex = (value = "") =>
  new RegExp(`^${escapeRegex(String(value).trim())}`, "i");
