const SHOWCASE_MEDIA_TYPE = {
  PHOTO: "PHOTO",
  VIDEO: "VIDEO",
};

const SHOWCASE_SECTION_TYPE = {
  CUSTOM: "CUSTOM",
  SYSTEM: "SYSTEM",
};

/**
 * AUTO   — the cover follows the first visible media, recomputed on every
 *          add / delete / reorder.
 * MANUAL — the vendor pinned a cover; automatic sync leaves it alone.
 */
const SHOWCASE_COVER_IMAGE_MODE = {
  AUTO: "AUTO",
  MANUAL: "MANUAL",
};

const SHOWCASE_MEDIA_CONFIG = {
  maxItems: 15,
  maxImages: 15,
  maxVideos: 5,
  maxImageSizeMB: 10,
  maxVideoSizeMB: 50,
  allowedImages: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
  allowedVideos: ["video/mp4", "video/webm", "video/quicktime"],
};

// `STORAGE_PROVIDER` used to live here. It was never showcase-specific —
// banners, vouchers and tickers all store the same field — so it moved to
// `constants/storage.js` alongside the rest of the storage vocabulary.

module.exports = {
  SHOWCASE_MEDIA_TYPE,
  SHOWCASE_SECTION_TYPE,
  SHOWCASE_COVER_IMAGE_MODE,
  SHOWCASE_MEDIA_CONFIG,
};
