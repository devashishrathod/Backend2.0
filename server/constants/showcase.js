const { MEDIA_KIND } = require("./storage");

/**
 * What a gallery item is, **as a customer's renderer sees it**.
 *
 * ⚠️ Deliberately coarser than `MEDIA_KIND`, and deliberately kept. A gallery
 * renders two things: a picture or a player. A GIF is a picture — so it reads as
 * `PHOTO` here (locked: S-7) — while `media.kind` keeps the finer truth, which
 * is what routes the file to `gifs/` and clear of the resize step that would
 * flatten its animation.
 *
 * 🔴 **Never stored.** This is derived from `media.kind` on the way out. A
 * stored copy is a second source of truth that can disagree with the bytes it
 * describes — the exact shape of the bug the banner carried, where
 * `type: "VIDEO"` could sit beside an image file and nothing noticed.
 */
const SHOWCASE_MEDIA_TYPE = {
  PHOTO: "PHOTO",
  VIDEO: "VIDEO",
};

/** `MEDIA_KIND` → what the wire calls it. */
const showcaseTypeOf = (kind) =>
  kind === MEDIA_KIND.VIDEO
    ? SHOWCASE_MEDIA_TYPE.VIDEO
    : SHOWCASE_MEDIA_TYPE.PHOTO;

/** The kinds that read as `PHOTO`. Used by the aggregation counts. */
const SHOWCASE_PHOTO_KINDS = Object.freeze([MEDIA_KIND.IMAGE, MEDIA_KIND.GIF]);

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
  SHOWCASE_PHOTO_KINDS,
  showcaseTypeOf,
  SHOWCASE_SECTION_TYPE,
  SHOWCASE_COVER_IMAGE_MODE,
  SHOWCASE_MEDIA_CONFIG,
};
