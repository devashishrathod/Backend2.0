const {
  uploadImageWithMetadata,
  deleteImage,
} = require("../../services/uploads");
const {
  TICKER_ICON_ALLOWED_MIME_TYPES,
} = require("../../constants/promotionalTicker");
const { throwError } = require("../../utils");

exports.uploadTickerIcon = async (file) => {
  if (!file) throwError(422, "Please upload an icon image.");

  if (!TICKER_ICON_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throwError(
      422,
      `Invalid icon file. Expected one of: ${TICKER_ICON_ALLOWED_MIME_TYPES.join(", ")}, but received "${file.mimetype}".`,
    );
  }

  const media = await uploadImageWithMetadata(file.tempFilePath, file);
  return { url: media.url, storage: media.storage };
};

exports.deleteTickerIcon = async (icon) => {
  try {
    if (!icon?.url) return;
    await deleteImage(icon.url);
  } catch (error) {
    console.error("Failed to delete ticker icon:", error.message);
  }
};
