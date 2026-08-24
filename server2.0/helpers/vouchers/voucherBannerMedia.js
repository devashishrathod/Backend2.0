const {
  uploadImageWithMetadata,
  uploadVideoWithMetadata,
  deleteImage,
  deleteAudioOrVideo,
} = require("../../services/uploads");
const {
  VOUCHER_BANNER_TYPE,
  VOUCHER_BANNER_MEDIA_FIELD,
  VOUCHER_BANNER_ALLOWED_MIME_TYPES,
} = require("../../constants/voucherBanner");
const { throwError } = require("../../utils");

exports.uploadVoucherBannerMedia = async (type, file) => {
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

  if (type === VOUCHER_BANNER_TYPE.VIDEO) {
    const media = await uploadVideoWithMetadata(file.tempFilePath, file);
    return { url: media.url, storage: media.storage };
  }

  const media = await uploadImageWithMetadata(file.tempFilePath, file);
  return { url: media.url, storage: media.storage };
};

exports.deleteVoucherBannerMedia = async (type, media) => {
  try {
    if (!media?.url) return;
    if (type === VOUCHER_BANNER_TYPE.VIDEO) {
      await deleteAudioOrVideo(media.url);
    } else {
      await deleteImage(media.url);
    }
  } catch (error) {
    console.error(
      `Failed to delete voucher banner ${type} media:`,
      error.message,
    );
  }
};
