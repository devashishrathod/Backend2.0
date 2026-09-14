const storage = require("../../services/storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");
const {
  VOUCHER_BANNER_MEDIA_FIELD,
  VOUCHER_BANNER_ALLOWED_MIME_TYPES,
} = require("../../constants/voucherBanner");
const { throwError } = require("../../utils");

/** @param voucherId  goes into the object key — see `helpers/banners/media.js`. */
exports.uploadVoucherBannerMedia = async (type, file, voucherId) => {
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

  // ⚠️ Kind from the mime type, not from `type` — a GIF has to reach `gifs/`.
  const media = await storage.uploadFromPath({
    filePath: file.tempFilePath,
    originalFile: file,
    purpose: UPLOAD_PURPOSE.VOUCHER_BANNER,
    entityId: voucherId,
  });
  return { url: media.url, storage: media.storage };
};

/**
 * ⚠️ Deletes through the stored `storage`, not the URL.
 *
 * The row has carried a `storage` object since the field was added, and going
 * via the URL meant `deleteFile` had to recognise the host before it would act
 * — so an S3 URL was skipped with a `console.log` and the file stayed. The
 * banner type is passed on so a GIF is not destroyed as a plain image.
 */
exports.deleteVoucherBannerMedia = async (type, media) => {
  try {
    if (!media?.url) return;
    await storage.deleteAsset({ url: media.url, storage: media.storage, type });
  } catch (error) {
    console.error(
      `Failed to delete voucher banner ${type} media:`,
      error.message,
    );
  }
};
