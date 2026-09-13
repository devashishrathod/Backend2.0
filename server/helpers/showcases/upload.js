const { SHOWCASE_MEDIA_TYPE } = require("../../constants/showcase");
const {
  STORAGE_PROVIDER,
  MEDIA_KIND,
  UPLOAD_PURPOSE,
} = require("../../constants/storage");
const { getOptimizedImageUrl } = require("../cloudinary");
const storage = require("../../services/storage");
const { throwError } = require("../../utils");

/**
 * @param sectionId  goes into the object key, so an object can be traced back
 *                   to the section that owns it.
 */
exports.uploadSingleMedia = async (file, sectionId) => {
  if (!file) throwError(400, "Media file is required.");

  const isImage = file.mimetype?.startsWith("image");
  const isVideo = file.mimetype?.startsWith("video");
  if (!isImage && !isVideo) throwError(400, "Unsupported media type.");

  const media = await storage.uploadFromPath({
    filePath: file.tempFilePath,
    originalFile: file,
    purpose: UPLOAD_PURPOSE.SHOWCASE_MEDIA,
    entityId: sectionId,
  });

  return {
    type: isImage ? SHOWCASE_MEDIA_TYPE.PHOTO : SHOWCASE_MEDIA_TYPE.VIDEO,
    ...media,
  };
};

exports.uploadMultipleMedia = async (files = [], sectionId) => {
  const uploaded = [];
  for (const file of files) {
    const media = await exports.uploadSingleMedia(file, sectionId);
    uploaded.push(media);
  }
  return uploaded;
};

/**
 * Delete the file behind a media.
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
    return await storage.deleteAsset(media);
  } catch (error) {
    console.error(`Failed to delete media: ${media?.url}`, error.message);
    return false;
  }
};

/**
 * Did the vendor upload this thumbnail themselves?
 *
 * A PHOTO's thumbnail *is* its own delivery URL, and a VIDEO's default poster
 * is derived from the video itself — destroying either would take the media
 * down with it. Only a separately uploaded poster is safe to delete.
 *
 * 🔴 The old answer was a URL comparison: is the thumbnail equal to
 * `getOptimizedImageUrl(storage.publicId)`? On S3 `publicId` is `null`, so that
 * comparison was skipped entirely and **every** auto-generated poster read as
 * custom. Changing a video's poster would then delete the poster the vendor was
 * still looking at, leaving a black tile in the section.
 *
 * `thumbnailStorage` is written only when a poster is uploaded on its own, so
 * its presence is the answer and there is nothing to infer.
 */
exports.isCustomThumbnail = (media) => {
  const own = media?.thumbnailStorage;
  if (own?.key || own?.publicId) return true;

  const thumbnail = media?.thumbnail;
  if (!thumbnail || thumbnail === media.url) return false;

  // Rows written before `thumbnailStorage` existed have to be read the old
  // way — but only on Cloudinary, where a default poster really is a
  // transformation of the media's own public id. On S3 there is no such
  // relationship to detect, and guessing wrong deletes a live poster, so an
  // S3 row without the field is treated as not custom.
  const provider = media?.storage?.provider ?? STORAGE_PROVIDER.CLOUDINARY;
  if (provider !== STORAGE_PROVIDER.CLOUDINARY) return false;

  const publicId = media?.storage?.publicId;
  if (publicId && thumbnail === getOptimizedImageUrl(publicId)) return false;

  return true;
};

/**
 * Delete a thumbnail the vendor uploaded, and only that.
 *
 * `updateSectionMedia` guarded this with `if (thumbnail.image)` — a property no
 * upload object has — so the old poster was never actually removed and every
 * thumbnail change left an orphan asset behind on Cloudinary.
 */
exports.deleteCustomThumbnail = async (media) => {
  if (!exports.isCustomThumbnail(media)) return false;
  try {
    // A poster is always an image, whatever the media it belongs to. Passing
    // `thumbnailStorage` means the delete goes by id or key rather than by
    // parsing the URL — and a legacy row without it still falls back to the URL.
    return await storage.deleteAsset({
      url: media.thumbnail,
      storage: media.thumbnailStorage || undefined,
      kind: MEDIA_KIND.IMAGE,
    });
  } catch (error) {
    // Best effort: an orphaned poster is not worth failing the request over.
    console.error("Old thumbnail delete failed:", error.message);
    return false;
  }
};

exports.deleteAllMedia = async (medias = []) => {
  await storage.deleteAssets(medias);
};

exports.rollbackUploads = async (uploadedMedias = []) => {
  if (!uploadedMedias.length) return;
  await storage.deleteAssets(uploadedMedias);
};
