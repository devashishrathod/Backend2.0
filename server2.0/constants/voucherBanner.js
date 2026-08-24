// Independent from constants/banner.js on purpose — the voucher's master
// banner has no relation to the standalone Banner feature, it just follows
// the same media-handling pattern.
const VOUCHER_BANNER_TYPE = {
  IMAGE: "IMAGE",
  VIDEO: "VIDEO",
  GIF: "GIF",
};

// Maps the public/API-facing type value to the actual mongoose subdocument
// (and multipart file field) name, which stays lowercase.
const VOUCHER_BANNER_MEDIA_FIELD = {
  [VOUCHER_BANNER_TYPE.IMAGE]: "image",
  [VOUCHER_BANNER_TYPE.VIDEO]: "video",
  [VOUCHER_BANNER_TYPE.GIF]: "gif",
};

// Multipart file field name expected for each banner type.
const VOUCHER_BANNER_FILE_FIELD = {
  [VOUCHER_BANNER_TYPE.IMAGE]: "bannerImage",
  [VOUCHER_BANNER_TYPE.VIDEO]: "bannerVideo",
  [VOUCHER_BANNER_TYPE.GIF]: "bannerGif",
};

const VOUCHER_BANNER_ALLOWED_MIME_TYPES = {
  [VOUCHER_BANNER_TYPE.IMAGE]: [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
  ],
  [VOUCHER_BANNER_TYPE.VIDEO]: ["video/mp4", "video/webm", "video/quicktime"],
  [VOUCHER_BANNER_TYPE.GIF]: ["image/gif"],
};

module.exports = {
  VOUCHER_BANNER_TYPE,
  VOUCHER_BANNER_MEDIA_FIELD,
  VOUCHER_BANNER_FILE_FIELD,
  VOUCHER_BANNER_ALLOWED_MIME_TYPES,
};
