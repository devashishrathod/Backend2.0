const { kindFromMime } = require("../../constants/storage");
const { throwError } = require("../../utils");

/**
 * Turn what the storage facade hands back into what a model stores.
 *
 * ### Why this is one function and not eleven
 *
 * Every upload site used to write its own two lines — `image: uploaded.url` and
 * `imageStorage: uploaded.storage` — which is how the platform ended up knowing
 * a URL and a bucket and **nothing else** about the file it was serving: no
 * size, no dimensions, no mime type, no kind. Eleven places writing two fields
 * each is also eleven places to forget the third when one is added.
 *
 * ### ⚠️ `kind` is derived, not defaulted
 *
 * If the mime type does not resolve, this throws rather than guessing `IMAGE`.
 * A wrong `kind` is worse than a missing upload: it decides the object's prefix
 * (`images/` vs `gifs/` vs `videos/`), which decides whether the resize step
 * flattens an animation — and nothing downstream would ever question it.
 *
 * @param {object|null} uploaded  a `storage.uploadFromPath` result
 * @param {object} [options]
 * @param {string} [options.kind]   override, when the caller already knows
 * @param {object} [options.poster] a `posterSchema` value, for a video
 * @returns {object|null} a `mediaSchema` value
 */
exports.toMediaDocument = (uploaded, { kind, poster } = {}) => {
  if (!uploaded?.url) return null;

  const metadata = uploaded.metadata || {};
  const resolved = kind || kindFromMime(metadata.mimeType);

  if (!resolved) {
    throwError(
      500,
      `Cannot store media: no kind for "${metadata.mimeType || "no mime type"}".`,
    );
  }

  return {
    url: uploaded.url,
    storage: uploaded.storage,
    kind: resolved,
    mimeType: metadata.mimeType ?? null,
    sizeBytes: metadata.size ?? 0,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    duration: metadata.duration ?? 0,
    originalName: metadata.originalName ?? null,
    ...(poster ? { poster } : {}),
  };
};

/**
 * The delete-shaped view of a media field, for rows written before it existed.
 *
 * `storage.deleteAsset` wants `{ url, storage }`, and a `mediaSchema` value
 * already **is** that — so the new field can be passed straight through. A row
 * from before the migration has only the URL string beside it, and this is what
 * keeps the delete working for both without every caller branching.
 *
 * @param {object|null} media  the `*Media` field
 * @param {string|null} url    the legacy URL field beside it
 */
exports.toDeletable = (media, url) => {
  if (media?.url) return media;
  return url ? { url } : null;
};
