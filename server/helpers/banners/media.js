const storage = require("../../services/storage");
const {
  UPLOAD_PURPOSE,
  MEDIA_KIND,
  kindFromMime,
} = require("../../constants/storage");
const { BANNER_MEDIA_KINDS } = require("../../constants/banner");
const { toMediaDocument } = require("../media");
const { throwError } = require("../../utils");

/**
 * The file field a banner is uploaded under, and the one beside it for a video.
 *
 * One name, not three. The old API had the client pick `image`, `video` or `gif`
 * to match a `type` it also had to send — two ways of saying the same thing, and
 * a 422 whenever they disagreed. The server reads the bytes' mime type and knows
 * which it is.
 */
const BANNER_MEDIA_FILE_FIELD = "media";
const BANNER_POSTER_FILE_FIELD = "poster";

/**
 * Upload a banner's media, and a video's poster with it.
 *
 * ### ⚠️ The kind decides everything, and it comes from the file
 *
 * Not from a `type` in the body. `kindFromMime` reads the verified mime type,
 * which is also what routes the object to `images/`, `videos/` or `gifs/` — and
 * `gifs/` being separate is the only thing keeping the resize Lambda from
 * flattening an animation.
 *
 * ### 🔴 A video arrives with its poster or it does not arrive
 *
 * `mediaSchema` makes the poster mandatory on a VIDEO, so a missing one would
 * fail at `save()` — after the video bytes were already paid for and uploaded.
 * Checking here means the refusal costs nothing, and the message names the field
 * the caller has to add.
 *
 * Posters are never derived. Cloudinary's looked like it worked and did not:
 * `getOptimizedImageUrl(publicId)` builds an `/image/upload/` path for an asset
 * that lives under `/video/upload/`, so the URL 404s. S3 produces none at all.
 *
 * ### ⚠️ It takes **descriptions**, not files (U-5)
 *
 * `file` is what `describeIncoming` answered: `{ name, mimetype, size }` plus
 * exactly one of `file` or `uploadId`. Both roads produce the same shape, so
 * every rule below reads the same fields it always did.
 *
 * @param {object} actor       whose upload it is — the facade looks an intent up
 *                             by id **and** owner, so a signed permission is not
 *                             transferable
 * @param {object} file        the banner's description
 * @param {string} bannerId    goes into the object key, so the file can be
 *                             traced back to its row. On a create it is minted
 *                             before the insert, because the upload happens first
 * @param {object} [posterFile] the same shape, required when `file` is a video
 * @returns {Promise<object>}  a `mediaSchema` value
 */
exports.uploadBannerMedia = async (actor, file, bannerId, posterFile) => {
  if (!file) {
    throwError(
      422,
      `Please attach the banner file as "${BANNER_MEDIA_FILE_FIELD}".`,
    );
  }

  const kind = kindFromMime(file.mimetype);
  if (!kind || !BANNER_MEDIA_KINDS.includes(kind)) {
    throwError(
      422,
      `A banner has to be an image, a video or a GIF — "${file.mimetype || "unknown"}" is none of those.`,
    );
  }

  const isVideo = kind === MEDIA_KIND.VIDEO;
  if (isVideo && !posterFile) {
    throwError(
      422,
      `A video banner needs a poster image. Attach one as "${BANNER_POSTER_FILE_FIELD}".`,
    );
  }

  if (posterFile && kindFromMime(posterFile.mimetype) !== MEDIA_KIND.IMAGE) {
    throwError(
      422,
      `The poster has to be a still image — "${posterFile.mimetype || "unknown"}" is not one.`,
    );
  }

  const uploaded = await storage.acceptUpload(actor, {
    file: file.file,
    uploadId: file.uploadId,
    purpose: UPLOAD_PURPOSE.BANNER_MEDIA,
    entityId: bannerId,
  });

  let poster;
  if (isVideo) {
    /**
     * 🔴 `BANNER_POSTER`, not `BANNER_MEDIA` — a fix, not a translation.
     *
     * Same bucket, same `banners/<id>` prefix, so nothing moves. What differs is
     * the allowance: a poster is capped at 10 MB and refuses VIDEO outright,
     * which is right for a still. This path sent it as `BANNER_MEDIA` and bought
     * it the banner's 50 MB.
     *
     * On the presigned road the purpose is also the **only** thing telling the
     * two apart — share it and the ids become interchangeable, which makes the
     * tighter of the two rules the one a caller can skip.
     */
    const uploadedPoster = await storage.acceptUpload(actor, {
      file: posterFile.file,
      uploadId: posterFile.uploadId,
      purpose: UPLOAD_PURPOSE.BANNER_POSTER,
      entityId: bannerId,
    });

    /**
     * ⚠️ If the poster upload fails the video is already in the bucket. It is
     * cleaned up here rather than left behind, because nothing else will ever
     * reference it — no row is written until both halves exist.
     */
    if (!uploadedPoster?.url) {
      await exports.deleteBannerMedia(toMediaDocument(uploaded, { kind }));
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
 * Delete a banner's media, and its poster if it had one.
 *
 * ⚠️ By the stored `storage`, not by the URL — a URL has not been proof of where
 * the bytes are since the field was added, and on a private bucket it is not
 * even durable.
 *
 * Swallows and logs: a file that outlives its row is worth a log line, not a
 * failed request for an admin who has already watched the banner disappear.
 */
exports.deleteBannerMedia = async (media) => {
  if (!media?.url && !media?.storage) return;

  const targets = [media, media.poster].filter(
    (target) => target?.url || target?.storage,
  );

  for (const target of targets) {
    try {
      await storage.deleteAsset({ url: target.url, storage: target.storage });
    } catch (error) {
      console.error("Failed to delete banner media:", error.message);
    }
  }
};

exports.BANNER_MEDIA_FILE_FIELD = BANNER_MEDIA_FILE_FIELD;
exports.BANNER_POSTER_FILE_FIELD = BANNER_POSTER_FILE_FIELD;
