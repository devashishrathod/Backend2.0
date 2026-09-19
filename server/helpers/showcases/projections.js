const {
  SHOWCASE_MEDIA_TYPE,
  SHOWCASE_PHOTO_KINDS,
  showcaseTypeOf,
} = require("../../constants/showcase");
const { MEDIA_KIND } = require("../../constants/storage");
const { toMediaResponse } = require("../media");

/**
 * `PHOTO` / `VIDEO` as an aggregation expression, from `media.kind`.
 *
 * ⚠️ Derived, never read from a stored field — there is no stored field. See
 * `SHOWCASE_MEDIA_TYPE` for why, and S-7 for why a GIF reads as a PHOTO.
 */
const typeExpr = (as) => ({
  $cond: [
    { $eq: [`$$${as}.media.kind`, MEDIA_KIND.VIDEO] },
    SHOWCASE_MEDIA_TYPE.VIDEO,
    SHOWCASE_MEDIA_TYPE.PHOTO,
  ],
});

// ---------------------------------------------------------------------------
// One definition of "what a showcase looks like on the wire".
//
// Three endpoints read the same document for a customer — the brand profile
// (`getCustomerBrand`), the full gallery (`getBrandsAllShowcase`) and the clips
// feed (`getAllVideoClips`) — and each used to hand-roll its own `$filter`,
// sort and field list. That is how `isVisible` came to be enforced in one of
// them and silently missing from another. The shared pieces live here so a rule
// added once applies everywhere.
// ---------------------------------------------------------------------------

/**
 * Sections a customer may see.
 *
 * `isVisible` is the vendor's public switch, `isActive` their own on/off, and
 * both have to be true. Vendor and admin reads deliberately do NOT use this —
 * they only exclude `isDeleted`, so hidden sections stay togglable.
 *
 * ### 🆕 The fourth condition: enough media to be worth showing (S-4)
 *
 * A section below `minItemsPerSection` does not reach a customer at all. That is
 * the read half of the floor the write guards enforce in `guards.js`, and the
 * two have to agree: a guard that refuses to let a section fall below the floor
 * is pointless if a section that starts below it is served anyway — which is
 * exactly what a brand's first, empty section does.
 *
 * ⚠️ Counted over **visible** media, the same condition the rest of the pipeline
 * filters on. Counting stored rows instead would let a section of six hidden
 * photos qualify and then render empty.
 *
 * `minItems` is optional so vendor and admin reads can reuse the other three
 * conditions without inheriting this one — they must keep seeing the section
 * they are being told is too small.
 *
 * @param {ObjectId} brandObjectId
 * @param {object} [options]
 * @param {number} [options.minItems]  omit to skip the media-count condition
 */
exports.customerSectionMatch = (brandObjectId, { minItems } = {}) => {
  const match = {
    brandId: brandObjectId,
    isDeleted: false,
    isActive: true,
    isVisible: true,
  };

  /**
   * ⚠️ `>= 1` even when the floor is 1, rather than dropping the condition. An
   * empty section is never a customer's problem, and leaving the stage out at
   * `minItems: 1` would make that depend on a setting.
   */
  if (Number.isFinite(minItems)) {
    match.$expr = {
      $gte: [
        {
          $size: {
            $filter: {
              input: { $ifNull: ["$medias", []] },
              as: "m",
              cond: exports.visibleMediaCondition("m"),
            },
          },
        },
        Math.max(minItems, 1),
      ],
    };
  }

  return match;
};

/** Media a customer may see. Nothing to do with the clips feed. */
exports.visibleMediaCondition = (as = "m") => ({
  $and: [
    { $eq: [`$$${as}.isActive`, true] },
    { $eq: [`$$${as}.isDeleted`, false] },
  ],
});

/** Media a vendor / admin may see — soft-deleted rows excluded, nothing else. */
exports.managedMediaCondition = (as = "m") => ({
  $eq: [`$$${as}.isDeleted`, false],
});

/**
 * Media that may appear in the customer's clips feed.
 *
 * The media half of the double opt-in: a VIDEO the vendor has not opted out of.
 * The section half (`isShowVideosInClips`) is a plain `$match` field, and the
 * type test is what keeps a photo's stale `isShowInVideoClips` from ever
 * mattering.
 */
exports.clipEligibleMediaCondition = (as = "m") => ({
  $and: [
    // Straight off the file's own kind — no derivation needed, because VIDEO is
    // the one value that means the same thing in both vocabularies.
    { $eq: [`$$${as}.media.kind`, MEDIA_KIND.VIDEO] },
    { $eq: [`$$${as}.isActive`, true] },
    { $eq: [`$$${as}.isDeleted`, false] },
    { $eq: [`$$${as}.isShowInVideoClips`, true] },
  ],
});

/** Clip-eligible videos of a section, already in display order. */
exports.sortedClipMedias = (input = "$medias") => ({
  $sortArray: {
    input: {
      $filter: { input, as: "m", cond: exports.clipEligibleMediaCondition("m") },
    },
    sortBy: { sortOrder: 1 },
  },
});

/** Visible media of a section, already in display order. */
exports.sortedVisibleMedias = (input = "$medias") => ({
  $sortArray: {
    input: {
      $filter: { input, as: "m", cond: exports.visibleMediaCondition("m") },
    },
    sortBy: { sortOrder: 1 },
  },
});

/**
 * `$size` of one wire type inside an already-filtered array.
 *
 * ⚠️ `PHOTO` is two kinds, not one — a GIF counts as a photo (S-7), so the test
 * is membership rather than equality.
 */
exports.countMediaOfType = (input, type) => ({
  $size: {
    $filter: {
      input,
      as: "m",
      cond:
        type === SHOWCASE_MEDIA_TYPE.VIDEO
          ? { $eq: ["$$m.media.kind", MEDIA_KIND.VIDEO] }
          : { $in: ["$$m.media.kind", SHOWCASE_PHOTO_KINDS] },
    },
  },
});

/** mediaCount / photoCount / videoCount over an already-filtered array. */
exports.mediaCounts = (input) => ({
  mediaCount: { $size: input },
  photoCount: exports.countMediaOfType(input, SHOWCASE_MEDIA_TYPE.PHOTO),
  videoCount: exports.countMediaOfType(input, SHOWCASE_MEDIA_TYPE.VIDEO),
});

/**
 * The customer's view of one media, as an aggregation expression.
 *
 * A strict whitelist, not a blacklist: `storage` (Cloudinary public ids),
 * `metadata` (original filenames), and the vendor's own toggles — `isActive`,
 * `isShowInVideoClips` — are absent because they are never named, so a field
 * added to the model tomorrow cannot leak by default.
 *
 * @param {object} [options]
 * @param {boolean} [options.withCreatedAt]  include `createdAt`
 * @param {boolean} [options.withVideoMeta]  include `duration` / `resolution`,
 *        emitted only on VIDEO rows so photo payloads stay clean.
 * @param {boolean} [options.withSortOrder]  include `sortOrder`. Off for the
 *        clips feed, where a media has been lifted out of its section and a
 *        per-section position means nothing — see `getAllVideoClips`.
 */
exports.customerMediaFields = ({
  as = "m",
  withCreatedAt = true,
  withVideoMeta = true,
  withSortOrder = true,
} = {}) => {
  const ref = (field) => `$$${as}.${field}`;
  const isVideo = { $eq: [ref("media.kind"), MEDIA_KIND.VIDEO] };

  const fields = {
    _id: ref("_id"),
    // Derived, not stored — see `SHOWCASE_MEDIA_TYPE`.
    type: typeExpr(as),
    url: ref("media.url"),
    /**
     * 🔴 A video answers its **poster**; a photo answers itself.
     *
     * This used to read a stored `thumbnail` field that was `url` again on a
     * photo (the same string twice) and, on S3, missing on a video — which made
     * the cover an `.mp4`. The poster is mandatory now, so the video branch
     * always has something real to give.
     */
    thumbnail: {
      $cond: [isVideo, ref("media.poster.url"), ref("media.url")],
    },
    title: ref("title"),
    altText: ref("altText"),
  };

  /**
   * ⚠️ The **stored** position, and every customer read overwrites it before
   * answering — see `applyDisplayPositions`. It is projected at all because the
   * clips feed sorts on it inside the pipeline, and because dropping it here
   * would mean each caller re-deriving a field it is about to replace anyway.
   */
  if (withSortOrder) fields.sortOrder = ref("sortOrder");
  if (withCreatedAt) fields.createdAt = ref("createdAt");
  if (!withVideoMeta) return fields;

  // Two whole shapes behind a `$cond`, rather than per-field `$$REMOVE`: a
  // photo has no duration and no meaningful resolution to report, and this way
  // the payload difference is one branch you can read rather than three
  // conditionals whose behaviour inside `$map` would have to be taken on trust.
  return {
    $cond: [
      isVideo,
      {
        ...fields,
        duration: { $ifNull: [ref("media.duration"), 0] },
        resolution: {
          width: ref("media.width"),
          height: ref("media.height"),
        },
      },
      fields,
    ],
  };
};

/** `customerMediaFields` mapped over an array expression. */
exports.customerMediaMap = (input, options = {}) => ({
  $map: {
    input,
    as: options.as || "m",
    in: exports.customerMediaFields(options),
  },
});

/**
 * Number a customer's sections and media 1, 2, 3 — in place (S-4, S-12).
 *
 * ### 🔴 Two different numbers wear the name `sortOrder`
 *
 * The **stored** one is dense over everything not deleted, hidden rows included,
 * so a vendor switching a media back on finds it where they left it. The
 * **customer's** one is dense over what that customer can actually see. They are
 * not the same number and neither can serve for the other.
 *
 * Serving the stored one is what produced `1, 3` on a customer's screen: the
 * vendor hid the second photo, the section stayed at positions 1 and 3, and the
 * app either showed a gap or rendered its list in an order that depended on how
 * it read the field. Anything the customer cannot see should not leave a hole
 * where it used to be.
 *
 * ### Why JS and not `$setWindowFields`
 *
 * `$documentNumber` would do this in the pipeline, but it appears nowhere else
 * in this codebase and would tie these three endpoints to a newer server than
 * everything around them. The arrays are small by construction — a plan caps a
 * brand at a handful of sections, each holding at most `maxItemsPerSection`
 * media — so the loop costs nothing measurable.
 *
 * ⚠️ Positions continue across pages. A section is the third of the brand's
 * gallery whether or not this request started at the third; restarting at 1 on
 * page 2 would give two different sections the same position in one list.
 *
 * @param {Array}  sections         the projected sections, already in order
 * @param {object} [options]
 * @param {number} [options.startAt] position of the first section (1-based)
 * @param {string} [options.mediaKey] array to renumber inside each section
 * @returns {Array} the same array, for chaining
 */
exports.applyDisplayPositions = (
  sections = [],
  { startAt = 1, mediaKey = "medias" } = {},
) => {
  sections.forEach((section, index) => {
    section.sortOrder = startAt + index;

    const medias = section?.[mediaKey];
    if (!Array.isArray(medias)) return;
    medias.forEach((media, position) => {
      media.sortOrder = position + 1;
    });
  });

  return sections;
};

/**
 * One section without its media array, for write responses.
 *
 * `create` and `update` used to answer with the whole document, so renaming a
 * section shipped every media row back — Cloudinary public ids and original
 * filenames included — for a change that touched one string. The media list has
 * its own paginated endpoint.
 */
exports.formatSectionSummary = (section) => {
  const doc =
    typeof section?.toObject === "function" ? section.toObject() : section;
  const { medias, ...rest } = doc || {};

  return {
    ...rest,
    mediaCount: (medias || []).filter((media) => !media.isDeleted).length,
  };
};

/**
 * The vendor / admin view of one gallery item — plain JS, since the managed
 * reads work on a loaded document rather than a pipeline.
 *
 * ### 🔴 `storage` and `metadata` are gone, and one `media` object replaces them
 *
 * The panel does need file size and dimensions, and it still gets them — inside
 * `media`, through the same whitelist every other admin surface uses. What it no
 * longer gets is `storage.publicId` / `bucket` / `key`: those are the **address**
 * of the object, not detail about it, and the panel has never needed them.
 * `media.provider` answers "where does this live" without answering "how do I
 * fetch it behind your back".
 *
 * `metadata` as a nested object is gone with it — `mimeType`, `sizeBytes`,
 * `width`, `height` and `duration` sit directly on `media` now, the same way
 * they do for a banner or a brand logo.
 *
 * `isShowInVideoClips` is reported only for a VIDEO: on a photo the stored
 * value is meaningless, and showing a toggle that does nothing is worse than
 * showing none.
 */
exports.formatManagedMedia = (media) => {
  const item = typeof media?.toObject === "function" ? media.toObject() : media;
  const {
    _id,
    title,
    altText,
    sortOrder,
    isActive,
    isShowInVideoClips,
    createdAt,
    updatedAt,
  } = item;

  const type = showcaseTypeOf(item.media?.kind);

  const formatted = {
    _id,
    type,
    media: toMediaResponse(item.media, { forAdmin: true }),
    title,
    altText,
    sortOrder,
    isActive,
    createdAt,
    updatedAt,
  };

  if (type === SHOWCASE_MEDIA_TYPE.VIDEO) {
    formatted.isShowInVideoClips = isShowInVideoClips;
  }

  return formatted;
};
