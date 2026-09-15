const { MEDIA_KIND, UPLOAD_PURPOSE, kindFromMime } = require("../../constants/storage");
const { toMediaDocument } = require("../media");
const storage = require("../../services/storage");
const { throwError } = require("../../utils");

/** The form field a video's poster arrives under. */
const POSTER_FILE_FIELD = "thumbnail";

/**
 * Upload one gallery file, and a video's poster with it.
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
 * @param file        the media file
 * @param sectionId   goes into the object key, so an object can be traced back
 *                    to the section that owns it
 * @param posterFile  required when `file` is a video
 * @returns {Promise<object>} a `mediaSchema` value
 */
exports.uploadSingleMedia = async (file, sectionId, posterFile) => {
  if (!file) throwError(400, "Media file is required.");

  const kind = kindFromMime(file.mimetype);
  const isVideo = kind === MEDIA_KIND.VIDEO;
  const isImage = kind === MEDIA_KIND.IMAGE || kind === MEDIA_KIND.GIF;
  if (!isImage && !isVideo) throwError(400, "Unsupported media type.");

  if (isVideo && !posterFile) {
    throwError(
      422,
      `A video needs a poster image. Attach one as "${POSTER_FILE_FIELD}".`,
    );
  }

  if (posterFile && kindFromMime(posterFile.mimetype) !== MEDIA_KIND.IMAGE) {
    throwError(
      422,
      `The poster has to be a still image — "${posterFile.mimetype || "unknown"}" is not one.`,
    );
  }

  const uploaded = await storage.uploadFromPath({
    filePath: file.tempFilePath,
    originalFile: file,
    purpose: UPLOAD_PURPOSE.SHOWCASE_MEDIA,
    entityId: sectionId,
    kind,
  });

  let poster;
  if (isVideo) {
    const uploadedPoster = await storage.uploadFromPath({
      filePath: posterFile.tempFilePath,
      originalFile: posterFile,
      purpose: UPLOAD_PURPOSE.SHOWCASE_MEDIA,
      entityId: sectionId,
      kind: MEDIA_KIND.IMAGE,
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
 * @param files    the media files, in order
 * @param posters  posters by index — `posters[i]` belongs to `files[i]`
 */
exports.uploadMultipleMedia = async (files = [], sectionId, posters = []) => {
  const uploaded = [];
  for (const [index, file] of files.entries()) {
    uploaded.push(await exports.uploadSingleMedia(file, sectionId, posters[index]));
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
