const { escapeRegex } = require("../../validator/common");

/**
 * Everything this codebase does to a name: how it is shown, how it is matched,
 * and how it is keyed.
 *
 * Three questions, three answers, one file — because they are easy to confuse
 * and were already drifting apart when this was written.
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

/**
 * A name as it should be **shown**, from a name as it was typed.
 *
 * ### 🔴 Why this does not just capitalise every word
 *
 * A vendor who types carefully is the one a naive title-case hurts most:
 *
 *     KFC          →  Kfc
 *     iPhone       →  Iphone
 *     McDonald's   →  Mcdonald's
 *     TGI Friday's →  Tgi Friday's
 *
 * So the rule only acts on input that is **entirely lowercase** — which is the
 * one case that is unambiguously unformatted. One capital anywhere, and the
 * vendor is assumed to have meant it:
 *
 *     "john doe"   →  "John Doe"      (fixed)
 *     "30% off"    →  "30% Off"       (fixed)
 *     "30% OFF"    →  "30% OFF"       (left alone)
 *     "iPhone"     →  "iPhone"        (left alone)
 *
 * ⚠️ ALL-CAPS input is deliberately **not** touched. "JOHN DOE" is shouting and
 * "KFC" is a name, and nothing in the string tells the two apart — a length
 * heuristic rescues KFC and TGI and then ruins IKEA and HDFC.
 *
 * Hyphens split words as spaces do, so "jean-luc" becomes "Jean-Luc".
 *
 * ### ⚠️ Not for legal or KYC names
 *
 * `PAN.fullName`, `Brand.legalBusinessName` and the invoice `companyName` are
 * records of what a document says. They get `cleanName` and nothing more.
 */
exports.toDisplayName = (name) => {
  const trimmed = exports.cleanName(name);
  if (!trimmed || trimmed !== trimmed.toLowerCase()) return trimmed;
  return trimmed.replace(/(^|[\s-])([a-z])/g, (_, before, letter) =>
    before + letter.toUpperCase(),
  );
};

/**
 * Trim, and make runs of whitespace one space. Nothing else.
 *
 * What every name gets, including the ones `toDisplayName` must not touch — a
 * legal name with a stray double space is still the same legal name.
 */
exports.cleanName = (name) =>
  String(name ?? "")
    .trim()
    .replace(/\s+/g, " ");
