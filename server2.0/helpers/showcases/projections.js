const { SHOWCASE_MEDIA_TYPE } = require("../../constants/showcase");

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
 */
exports.customerSectionMatch = (brandObjectId) => ({
  brandId: brandObjectId,
  isDeleted: false,
  isActive: true,
  isVisible: true,
});

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
    { $eq: [`$$${as}.type`, SHOWCASE_MEDIA_TYPE.VIDEO] },
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

/** `$size` of one media type inside an already-filtered array. */
exports.countMediaOfType = (input, type) => ({
  $size: {
    $filter: {
      input,
      as: "m",
      cond: { $eq: ["$$m.type", type] },
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
 */
exports.customerMediaFields = ({
  as = "m",
  withCreatedAt = true,
  withVideoMeta = true,
} = {}) => {
  const ref = (field) => `$$${as}.${field}`;

  const fields = {
    _id: ref("_id"),
    type: ref("type"),
    url: ref("url"),
    thumbnail: ref("thumbnail"),
    title: ref("title"),
    altText: ref("altText"),
    sortOrder: ref("sortOrder"),
  };

  if (withCreatedAt) fields.createdAt = ref("createdAt");
  if (!withVideoMeta) return fields;

  // Two whole shapes behind a `$cond`, rather than per-field `$$REMOVE`: a
  // photo has no duration and no meaningful resolution to report, and this way
  // the payload difference is one branch you can read rather than three
  // conditionals whose behaviour inside `$map` would have to be taken on trust.
  return {
    $cond: [
      { $eq: [ref("type"), SHOWCASE_MEDIA_TYPE.VIDEO] },
      {
        ...fields,
        duration: { $ifNull: [ref("metadata.duration"), 0] },
        resolution: {
          width: ref("metadata.width"),
          height: ref("metadata.height"),
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
 * The vendor / admin view of one media — plain JS, since the managed reads work
 * on a loaded document rather than a pipeline.
 *
 * Keeps `storage` and `metadata` (the panel shows file size and dimensions) and
 * every toggle, because the whole point of the managed view is to edit them.
 * `isShowInVideoClips` is reported only for a VIDEO: on a photo the stored
 * value is meaningless, and showing a toggle that does nothing is worse than
 * showing none.
 */
exports.formatManagedMedia = (media) => {
  const item = typeof media?.toObject === "function" ? media.toObject() : media;
  const {
    _id,
    type,
    url,
    thumbnail,
    title,
    altText,
    sortOrder,
    isActive,
    isShowInVideoClips,
    storage,
    metadata,
    createdAt,
    updatedAt,
  } = item;

  const formatted = {
    _id,
    type,
    url,
    thumbnail,
    title,
    altText,
    sortOrder,
    isActive,
    storage,
    metadata,
    createdAt,
    updatedAt,
  };

  if (type === SHOWCASE_MEDIA_TYPE.VIDEO) {
    formatted.isShowInVideoClips = isShowInVideoClips;
  }

  return formatted;
};
