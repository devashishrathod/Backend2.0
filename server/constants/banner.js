const { MEDIA_KIND } = require("./storage");

/**
 * What a banner is allowed to be.
 *
 * ### 🔴 What this replaces
 *
 * Three constants used to live here — `BANNER_TYPE`, `BANNER_MEDIA_FIELD` and
 * `BANNER_ALLOWED_MIME_TYPES` — and together they were a second, private copy
 * of a question `MEDIA_KIND` already answers.
 *
 *   - `BANNER_TYPE` was `MEDIA_KIND` minus two rows, spelled out again. Adding
 *     a kind meant remembering to add it in both places.
 *   - `BANNER_MEDIA_FIELD` mapped the enum to a subdocument name, and existed
 *     only because there *were* three subdocuments. There is one now.
 *   - `BANNER_ALLOWED_MIME_TYPES` was one of **four** hand-written mime
 *     allow-lists in the codebase that disagreed with each other. The facade
 *     resolves a kind from the verified mime type; a banner then only has to say
 *     which **kinds** it accepts, which is this list.
 *
 * ⚠️ Deliberately not `Object.values(MEDIA_KIND)`. A banner is something the
 * home screen renders — `AUDIO` and `DOCUMENT` are not banners, and leaving them
 * out here is what makes that a rule rather than a convention.
 */
const BANNER_MEDIA_KINDS = Object.freeze([
  MEDIA_KIND.IMAGE,
  MEDIA_KIND.VIDEO,
  MEDIA_KIND.GIF,
]);

const BANNER_REDIRECT_TYPE = {
  NONE: "NONE",
  CATEGORY: "CATEGORY",
  DEAL: "DEAL",
  BRAND: "BRAND",
  OFFER: "OFFER",
  EXTERNAL_URL: "EXTERNAL_URL",
};

const BANNER_SORT_BY = {
  CREATED_AT: "createdAt",
  START_DATE: "startDate",
  END_DATE: "endDate",
  TITLE: "title",
};

// How many banners the home screen carries at one moment.
//
// There are two pools and this caps each of them separately, because they never
// compete for the same slot at write time:
//
//   - scheduled — a start/end date pair. At most this many may be live at any
//     single instant, which is a peak, not a count of overlaps with the new
//     range (see `helpers/banners/validate.js`).
//   - evergreen — no dates at all. At most this many active.
//
// The customer response is scheduled first, evergreen filling whatever is left,
// truncated to this many in total — so 4 scheduled banners today are followed by
// 6 evergreen ones, and 10 scheduled banners hide the evergreen pool entirely.
const BANNER_ACTIVE_LIMIT = 10;

module.exports = {
  BANNER_MEDIA_KINDS,
  BANNER_REDIRECT_TYPE,
  BANNER_SORT_BY,
  BANNER_ACTIVE_LIMIT,
};
