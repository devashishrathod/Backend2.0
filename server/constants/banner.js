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

module.exports = {
  BANNER_TYPE,
  BANNER_MEDIA_FIELD,
  BANNER_ALLOWED_MIME_TYPES,
  BANNER_REDIRECT_TYPE,
  BANNER_SORT_BY,
};
