const {
  uploadImageWithMetadata,
  uploadVideoWithMetadata,
  deleteImage,
  deleteAudioOrVideo,
} = require("../../services/uploads");
const {
  BANNER_TYPE,
  BANNER_MEDIA_FIELD,
  BANNER_ALLOWED_MIME_TYPES,
} = require("../../constants/banner");
const { throwError } = require("../../utils");

exports.uploadBannerMedia = async (type, file) => {
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

  if (type === BANNER_TYPE.VIDEO) {
    const media = await uploadVideoWithMetadata(file.tempFilePath, file);
    return { url: media.url, storage: media.storage };
  }

  const media = await uploadImageWithMetadata(file.tempFilePath, file);
  return { url: media.url, storage: media.storage };
};

exports.deleteBannerMedia = async (type, media) => {
  try {
    if (!media?.url) return;
    if (type === BANNER_TYPE.VIDEO) {
      await deleteAudioOrVideo(media.url);
    } else {
      await deleteImage(media.url);
    }
  } catch (error) {
    console.error(`Failed to delete banner ${type} media:`, error.message);
  }
};
