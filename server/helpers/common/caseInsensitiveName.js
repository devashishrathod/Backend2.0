const { escapeRegex } = require("../../validator/common");

/**
 * Match a name the way a person would, and store it the way they typed it.
 *
 * ### 🔴 The two halves of this, and why they came apart
 *
 * These surfaces used to lowercase the name **on write**, which made the
 * duplicate check case-insensitive for free — `findOne({ name })` could not
 * miss "Pizza" when "pizza" was stored. It also meant the customer app rendered
 * "cafe mocha" for a brand that had typed "Cafe Mocha".
 *
 * Fixing the display half by storing the name as typed silently removed the
 * matching half: an exact-match `findOne` stopped seeing "pizza" when the row
 * said "Pizza", and both could then exist. The unique index behind some of them
 * could not help either — it compares bytes, not meaning.
 *
 * So the two are separated here. The stored value is what was typed. The
 * comparison is anchored and case-insensitive, which is what "already exists"
 * means to the person reading the error.
 *
 * ### ⚠️ Anchored, and escaped
 *
 * `^…$` because an unanchored regex makes "Pizza" collide with "Pizza Hut", and
 * `escapeRegex` because a name is user input — a `.` in "St. Mary's" must be a
 * full stop, and a `.*` must not turn the filter off.
 */

/**
 * @param {string} name  as the user typed it
 * @returns {object|null} a Mongo condition, or null when there is no name
 */
exports.sameNameAs = (name) => {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return null;
  return { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, "i") };
};

/**
 * The key a uniqueness **index** can enforce.
 *
 * A regex cannot back a unique index, so surfaces that need the database itself
 * to refuse a duplicate — vouchers do, through `{ brandId, normalizedName }` —
 * store this beside the real name. It is a comparison key and nothing else:
 * never displayed, never returned.
 *
 * ⚠️ Whitespace is collapsed as well as trimmed, so "Pizza  Hut" and
 * "Pizza Hut" are one name. Create and update must both use this, or a name
 * normalised one way slips past a row normalised the other.
 */
exports.normalizedNameKey = (name) =>
  String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
