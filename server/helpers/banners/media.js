const storage = require("../../services/storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");
const {
  BANNER_MEDIA_FIELD,
  BANNER_ALLOWED_MIME_TYPES,
} = require("../../constants/banner");
const { throwError } = require("../../utils");

/**
 * @param bannerId  goes into the object key, so the file can be traced back to
 *                  the row it belongs to. On a create it is minted before the
 *                  insert, because the upload happens first.
 */
exports.uploadBannerMedia = async (type, file, bannerId) => {
  const field = BANNER_MEDIA_FIELD[type];
  if (!file)
    throwError(422, `Please upload a ${field} file for this banner type.`);

  const allowedMimeTypes = BANNER_ALLOWED_MIME_TYPES[type] || [];
  if (!allowedMimeTypes.includes(file.mimetype)) {
    throwError(
      422,
      `Invalid file for banner type ${type}. Expected one of: ${allowedMimeTypes.join(", ")}, but received "${file.mimetype}".`,
    );
  }

  // ⚠️ The kind comes from the file's mime type, not from `type`. A GIF banner
  // arrives as `image/gif` and must land under `gifs/`, away from the resize
  // Lambda that would flatten its animation.
  const media = await storage.uploadFromPath({
    filePath: file.tempFilePath,
    originalFile: file,
    purpose: UPLOAD_PURPOSE.BANNER_MEDIA,
    entityId: bannerId,
  });
  return { url: media.url, storage: media.storage };
};

/**
 * ⚠️ Deletes through the stored `storage`, not the URL — the row has carried
 * one since the field was added, and a URL is no longer proof of where the
 * bytes are. `type` goes along so a GIF is not destroyed as a plain image.
 */
exports.deleteBannerMedia = async (type, media) => {
  try {
    if (!media?.url) return;
    await storage.deleteAsset({ url: media.url, storage: media.storage, type });
  } catch (error) {
    console.error(`Failed to delete banner ${type} media:`, error.message);
  }
};
