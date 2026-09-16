const storage = require("../../services/storage");
const {
  UPLOAD_PURPOSE,
  MEDIA_KIND,
  kindFromMime,
} = require("../../constants/storage");
const {
  VOUCHER_BANNER_MEDIA_FIELD,
  VOUCHER_BANNER_ALLOWED_MIME_TYPES,
} = require("../../constants/voucherBanner");
const { toMediaDocument } = require("../media");
const { throwError } = require("../../utils");

/** The form field a video banner's poster arrives under. */
const BANNER_POSTER_FILE_FIELD = "bannerThumbnail";

/**
 * Upload a voucher's banner, and a video's poster with it.
 *
 * ### 🔴 A video banner arrives with its poster or it does not arrive
 *
 * `mediaSchema` makes the poster mandatory on a VIDEO, so a missing one fails at
 * `save()` — after the video bytes are already uploaded and paid for. Refusing
 * here costs nothing and names the form field the caller has to add.
 *
 * Posters are never derived, on either provider: Cloudinary's
 * `getOptimizedImageUrl(publicId)` builds an `/image/upload/` path for an asset
 * that lives under `/video/upload/` (a 404), and S3 produces none at all.
 *
 * @param type        the declared `VOUCHER_BANNER_TYPE`
 * @param file        the banner file
 * @param voucherId   goes into the object key — see `helpers/banners/media.js`
 * @param posterFile  required when the banner is a video
 * @returns {Promise<object>} a `mediaSchema` value
 */
exports.uploadVoucherBannerMedia = async (type, file, voucherId, posterFile) => {
  const field = VOUCHER_BANNER_MEDIA_FIELD[type];
  if (!file)
    throwError(422, `Please upload a ${field} file for the voucher banner.`);

  const allowedMimeTypes = VOUCHER_BANNER_ALLOWED_MIME_TYPES[type] || [];
  if (!allowedMimeTypes.includes(file.mimetype)) {
    throwError(
      422,
      `Invalid file for voucher banner type ${type}. Expected one of: ${allowedMimeTypes.join(", ")}, but received "${file.mimetype}".`,
    );
  }

  // ⚠️ Kind from the mime type, not from `type` — a GIF has to reach `gifs/`,
  // clear of the resize step that would flatten its animation.
  const kind = kindFromMime(file.mimetype);
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

  const uploaded = await storage.uploadFromPath({
    filePath: file.tempFilePath,
    originalFile: file,
    purpose: UPLOAD_PURPOSE.VOUCHER_BANNER,
    entityId: voucherId,
    kind,
  });

  let poster;
  if (isVideo) {
    const uploadedPoster = await storage.uploadFromPath({
      filePath: posterFile.tempFilePath,
      originalFile: posterFile,
      purpose: UPLOAD_PURPOSE.VOUCHER_BANNER,
      entityId: voucherId,
      kind: MEDIA_KIND.IMAGE,
    });

    // ⚠️ The video is already in the bucket if this fails. No row points at it
    // until both halves exist, so nothing would ever reference it.
    if (!uploadedPoster?.url) {
      await exports.deleteVoucherBannerMedia(
        type,
        toMediaDocument(uploaded, { kind }),
      );
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
 * Delete a voucher banner's file, and its poster if it had one.
 *
 * ⚠️ Deletes through the stored `storage`, not the URL.
 *
 * The row has carried a `storage` object since the field was added, and going
 * via the URL meant `deleteFile` had to recognise the host before it would act
 * — so an S3 URL was skipped with a `console.log` and the file stayed.
 */
exports.deleteVoucherBannerMedia = async (type, media) => {
  try {
    if (!media?.url && !media?.storage) return;

    const targets = [media, media.poster].filter(
      (target) => target?.url || target?.storage,
    );
    if (targets.length) await storage.deleteAssets(targets);
  } catch (error) {
    console.error(
      `Failed to delete voucher banner ${type} media:`,
      error.message,
    );
  }
};

exports.BANNER_POSTER_FILE_FIELD = BANNER_POSTER_FILE_FIELD;
