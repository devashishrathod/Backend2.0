const BANNER_TYPE = {
  IMAGE: "IMAGE",
  VIDEO: "VIDEO",
  GIF: "GIF",
};

// Maps the public/API-facing type value to the actual mongoose subdocument
// (and multipart file field) name, which stays lowercase.
const BANNER_MEDIA_FIELD = {
  [BANNER_TYPE.IMAGE]: "image",
  [BANNER_TYPE.VIDEO]: "video",
  [BANNER_TYPE.GIF]: "gif",
};

const BANNER_ALLOWED_MIME_TYPES = {
  [BANNER_TYPE.IMAGE]: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
  [BANNER_TYPE.VIDEO]: ["video/mp4", "video/webm", "video/quicktime"],
  [BANNER_TYPE.GIF]: ["image/gif"],
};

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
  BANNER_TYPE,
  BANNER_MEDIA_FIELD,
  BANNER_ALLOWED_MIME_TYPES,
  BANNER_REDIRECT_TYPE,
  BANNER_SORT_BY,
  BANNER_ACTIVE_LIMIT,
};
