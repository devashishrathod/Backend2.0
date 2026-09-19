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

/**
 * The last-resort fallback when `Setting.vendor.showcase` has no value.
 *
 * ⚠️ Every number here has a twin on the Setting schema, and the two must agree.
 * They are not one source: the schema's defaults apply to a document being
 * created, and these apply to a document that somehow lacks the field. A
 * disagreement between them is a platform that behaves differently depending on
 * how old its settings row is.
 */
const SHOWCASE_MEDIA_CONFIG = {
  maxItems: 15,
  maxImages: 15,
  maxVideos: 5,
  /** The floor — see `minItemsPerSection` on the schema for what raising it does. */
  minItems: 3,
  minSections: 1,
  maxImageSizeMB: 10,
  /** Larger than an image on purpose: a GIF stores every frame whole. */
  maxGifSizeMB: 15,
  maxVideoSizeMB: 50,
  allowedImages: [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
  ],
  allowedVideos: ["video/mp4", "video/webm", "video/quicktime"],
};

/**
 * Why a section is not on a customer's screen (S-5).
 *
 * Machine codes, so a panel can branch and localise. The numbers a message needs
 * — how many visible media the section has, and how many it needs — ride
 * alongside in `customerVisibility`, because a client that has to fetch the
 * platform settings to phrase "2 of 3" will end up caching the wrong number.
 *
 * ⚠️ There is deliberately no `DELETED`. Both managed reads filter deleted
 * sections out before visibility is described, so the value could never be
 * returned — and a value that cannot occur is worse than none, because clients
 * write branches for it.
 */
const SHOWCASE_VISIBILITY_REASON = {
  /** `isVisible: false` — the vendor's public switch. */
  HIDDEN: "HIDDEN",
  /** `isActive: false` — the vendor's own on/off. */
  INACTIVE: "INACTIVE",
  /** Fewer visible media than `Setting.vendor.showcase.minItemsPerSection`. */
  NOT_ENOUGH_MEDIA: "NOT_ENOUGH_MEDIA",
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
  SHOWCASE_VISIBILITY_REASON,
};
