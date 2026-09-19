const { getStorageConfig, effectiveLimitMB } = require("./getStorageConfig");
const { getShowcaseConfig } = require("./getShowcaseConfig");
const {
  UPLOAD_PURPOSES,
  UPLOAD_PURPOSE,
  MEDIA_KIND,
} = require("../../constants/storage");

const MB = 1024 * 1024;

/**
 * How big a file may be on **this** surface, for **this** kind — in bytes.
 *
 * ### 🔴 Why this had to exist
 *
 * There were three answers to one question and nothing said which won:
 *
 * | Where | What it knows |
 * |---|---|
 * | `UPLOAD_PURPOSES[purpose].maxBytes` | a static per-surface ceiling in code |
 * | `Setting.storage.limits.*` | the platform ceiling the admin owns (ST-3) |
 * | `Setting.vendor.showcase.max*SizeMB` | a surface narrowing it (ST-4) |
 *
 * The multipart road read the third. The presigned road read **only the first**
 * — `presign` built its `content-length-range` from the constant, and `confirm`
 * never looked at size at all, though it holds the real one.
 *
 * So an admin lowering `storage.limits.maxVideoSizeMB` from 50 to 20 changed
 * what a vendor could upload through the panel and changed nothing about what
 * they could upload directly to S3. One platform, two limits, and the smaller
 * one was the one that could be turned off.
 *
 * ### ⚠️ The static ceiling stays in the chain, and it is not decoration
 *
 * It is the only one that survives a `Setting` document that is missing,
 * corrupt, or written by something that skipped `assertStorageLimitRule`. A
 * limit whose floor is "whatever the database says" is not a limit.
 *
 * ### ⚠️ Surface overrides are named here, one by one
 *
 * There is no lookup by convention. A surface gets its own row or it gets the
 * platform ceiling — because a convention ("`vendor.<entity>.max…`") would
 * silently start honouring a number the day somebody added it to the schema,
 * with no test and nobody deciding.
 */

/** Which surfaces narrow the platform ceiling, and how to read theirs. */
const SURFACE_LIMITS = Object.freeze({
  [UPLOAD_PURPOSE.SHOWCASE_MEDIA]: {
    config: getShowcaseConfig,
    byKind: {
      [MEDIA_KIND.IMAGE]: "maxImageSizeMB",
      [MEDIA_KIND.GIF]: "maxGifSizeMB",
      [MEDIA_KIND.VIDEO]: "maxVideoSizeMB",
    },
  },
  /**
   * ⚠️ A poster is metered as the image it is, against the same showcase
   * ceiling — `validateThumbnailFile` already holds it to `maxImageSizeMB`, and
   * a poster that could be larger than the photos beside it would be a hole in
   * the surface's own limit rather than a feature.
   */
  [UPLOAD_PURPOSE.SHOWCASE_THUMBNAIL]: {
    config: getShowcaseConfig,
    byKind: {
      // ⚠️ `IMAGE` only. The GIF row went with the purpose's own `kinds` — a
      // poster is a still, so `GIF` is a key that can no longer be reached, and
      // a limit for a kind that cannot arrive reads like a rule that exists.
      [MEDIA_KIND.IMAGE]: "maxImageSizeMB",
    },
  },
});

/**
 * @param {string} purpose  an `UPLOAD_PURPOSE`
 * @param {string} kind     a `MEDIA_KIND` — the limit is per kind, because a GIF
 *                          stores every frame whole and needs its own ceiling
 * @returns {Promise<{ maxBytes: number, maxSizeMB: number }>}
 */
exports.getUploadLimit = async (purpose, kind) => {
  const entry = UPLOAD_PURPOSES[purpose];
  if (!entry) {
    // The same answer `acceptUpload` gives: a surface naming a purpose that does
    // not exist is our bug, not the caller's.
    const error = new Error(`Unknown upload purpose: ${purpose}`);
    error.statusCode = 500;
    throw error;
  }

  const storage = await getStorageConfig();

  // The platform ceiling for this kind, already narrowed by nothing yet.
  let limitMB = storage.maxSizeMB[kind];

  const surface = SURFACE_LIMITS[purpose];
  if (surface) {
    const key = surface.byKind[kind];
    if (key) {
      const config = await surface.config();
      limitMB = effectiveLimitMB(limitMB, config[key]);
    }
  }

  /**
   * ⚠️ `Math.min` against the static ceiling **last**, so no setting can raise
   * it. `assertStorageLimitRule` refuses a surface above the platform ceiling on
   * save, but nothing refuses a platform ceiling above the code's — and this is
   * the number that decides whether one request can fill the disk.
   */
  const maxBytes = Math.min(
    entry.maxBytes,
    Number.isFinite(limitMB) ? limitMB * MB : entry.maxBytes,
  );

  return { maxBytes, maxSizeMB: Math.floor(maxBytes / MB) };
};

exports.SURFACE_LIMITS = SURFACE_LIMITS;
