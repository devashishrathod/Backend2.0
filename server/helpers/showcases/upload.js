const { MEDIA_KIND, UPLOAD_PURPOSE, kindFromMime } = require("../../constants/storage");
const { toMediaDocument } = require("../media");
const storage = require("../../services/storage");
const { throwError } = require("../../utils");

/** The form field a video's poster arrives under. */
const POSTER_FILE_FIELD = "thumbnail";

/** And the body field naming its upload, on the presigned road. */
const POSTER_UPLOAD_FIELD = "thumbnailUploadIds";

/**
 * Take one gallery item, and a video's poster with it.
 *
 * ### ⚠️ It takes a **description**, not a file (U-3)
 *
 * `item` is what `describeIncoming` answered: `{ name, mimetype, size }` plus
 * exactly one of `file` or `uploadId`. Both roads produce the same shape, so
 * every rule below reads the same fields it always did — and which road this
 * item came down stops being this file's business.
 *
 * ### 🔴 A video arrives with its poster or it does not arrive
 *
 * `mediaSchema` makes the poster mandatory on a VIDEO, so a missing one fails at
 * `save()` — after the video bytes are already uploaded and paid for. Refusing
 * here costs nothing and names the form field the caller has to add.
 *
 * ### ⚠️ Posters are never derived, on either provider
 *
 * Cloudinary's looked like it worked and did not: `getOptimizedImageUrl(publicId)`
 * builds an `/image/upload/` path for an asset that lives under `/video/upload/`,
 * so **every stored video poster was a 404**. S3 produces none at all, which made
 * a cover computed as `thumbnail || url` become the `.mp4` itself.
 *
 * That is also why `isCustomThumbnail` is gone. It answered "did the vendor
 * upload this poster, or did we derive it?" — a question with no reliable
 * answer: on S3 `publicId` is null so the URL comparison was skipped and every
 * derived poster read as **custom**, which meant changing a video's poster
 * deleted the one the vendor was still looking at. Nothing derives a poster now,
 * so the question does not exist.
 *
 * @param actor       whose upload it is — the facade looks an intent up by id
 *                    **and** owner, so a signed permission is not transferable
 * @param item        a `describeIncoming` result: `{ name, mimetype, size }`
 *                    plus exactly one of `file` or `uploadId`
 * @param sectionId   goes into the object key, so an object can be traced back
 *                    to the section that owns it
 * @param posterItem  the same shape, required when `item` is a video
 * @returns {Promise<object>} a `mediaSchema` value
 */
exports.uploadSingleMedia = async (actor, item, sectionId, posterItem) => {
  if (!item) throwError(400, "Media file is required.");

  const kind = kindFromMime(item.mimetype);
  const isVideo = kind === MEDIA_KIND.VIDEO;
  const isImage = kind === MEDIA_KIND.IMAGE || kind === MEDIA_KIND.GIF;
  if (!isImage && !isVideo) throwError(400, "Unsupported media type.");

  if (isVideo && !posterItem) {
    throwError(
      422,
      `A video needs a poster image. Attach one as "${POSTER_FILE_FIELD}", ` +
        `or name its upload as "${POSTER_UPLOAD_FIELD}".`,
    );
  }

  if (posterItem && kindFromMime(posterItem.mimetype) !== MEDIA_KIND.IMAGE) {
    throwError(
      422,
      `The poster has to be a still image — "${posterItem.mimetype || "unknown"}" is not one.`,
    );
  }

  const uploaded = await storage.acceptUpload(actor, {
    file: item.file,
    uploadId: item.uploadId,
    purpose: UPLOAD_PURPOSE.SHOWCASE_MEDIA,
    entityId: sectionId,
  });

  let poster;
  if (isVideo) {
    /**
     * ⚠️ `SHOWCASE_THUMBNAIL`, not `SHOWCASE_MEDIA` — and this is a fix, not a
     * translation.
     *
     * Both purposes land in the same bucket under the same `showcase/<section>`
     * prefix, so nothing moves. What differs is what they accept: a thumbnail is
     * capped at 10 MB and refuses VIDEO outright, which is exactly right for a
     * still. This path used to send the poster as `SHOWCASE_MEDIA` and buy it a
     * video's 50 MB allowance; `updateSectionMedia` already named the right one.
     *
     * 🔴 On the presigned road it is load-bearing for a second reason: a video
     * and its poster are two separate uploads, and an id issued for one must not
     * be spendable as the other.
     */
    const uploadedPoster = await storage.acceptUpload(actor, {
      file: posterItem.file,
      uploadId: posterItem.uploadId,
      purpose: UPLOAD_PURPOSE.SHOWCASE_THUMBNAIL,
      entityId: sectionId,
    });

    // ⚠️ The video is already in the bucket if this fails. No row is written
    // until both halves exist, so nothing would ever reference it.
    if (!uploadedPoster?.url) {
      await exports.deleteMedia(toMediaDocument(uploaded, { kind }));
      throwError(502, "The poster could not be uploaded. Please try again.");
    }

    poster = {
      url: uploadedPoster.url,
      storage: uploadedPoster.storage,
      width: uploadedPoster.metadata?.width ?? null,
      height: uploadedPoster.metadata?.height ?? null,
    };
  }

  return toMediaDocument(uploaded, { kind, poster });
};

/**
 * @param items    the described media, in the order they will be stored
 * @param posters  posters by index — `posters[i]` belongs to `items[i]`
 */
exports.uploadMultipleMedia = async (actor, items = [], sectionId, posters = []) => {
  const uploaded = [];
  for (const [index, item] of items.entries()) {
    uploaded.push(
      await exports.uploadSingleMedia(actor, item, sectionId, posters[index]),
    );
  }
  return uploaded;
};

/**
 * Delete the file behind a media, and its poster if it had one.
 *
 * 🔴 This used to be a `switch` on the provider with three ways to do nothing:
 * `case "S3"` was an empty `// Future Implementation` that returned as though
 * it had worked, the `default` branch `console.warn`ed and returned, and a
 * media with no `type` fell out of the Cloudinary branch untouched. The moment
 * anything was stored on S3, every delete on this path became a no-op that
 * reported success — the file stayed, the row went, and nothing anywhere said
 * so.
 *
 * The facade throws on a provider it does not know. The try/catch stays because
 * a failed cleanup genuinely should not fail the vendor's request, but now it
 * is a logged error rather than silence.
 */
exports.deleteMedia = async (media) => {
  try {
    if (!media) return false;
    const targets = [media, media.poster].filter(
      (target) => target?.url || target?.storage,
    );
    if (!targets.length) return false;

    await storage.deleteAssets(targets);
    return true;
  } catch (error) {
    console.error(`Failed to delete media: ${media?.url}`, error.message);
    return false;
  }
};

/** Every file of every media, posters included. */
const withPosters = (medias = []) =>
  (medias || [])
    .flatMap((media) => [media, media?.poster])
    .filter((target) => target?.url || target?.storage);

exports.deleteAllMedia = async (medias = []) => {
  await storage.deleteAssets(withPosters(medias));
};

exports.rollbackUploads = async (uploadedMedias = []) => {
  if (!uploadedMedias.length) return;
  await storage.deleteAssets(withPosters(uploadedMedias));
};

exports.POSTER_FILE_FIELD = POSTER_FILE_FIELD;
exports.POSTER_UPLOAD_FIELD = POSTER_UPLOAD_FIELD;
