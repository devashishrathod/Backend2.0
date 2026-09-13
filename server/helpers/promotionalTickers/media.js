const storage = require("../../services/storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");
const {
  TICKER_ICON_ALLOWED_MIME_TYPES,
} = require("../../constants/promotionalTicker");
const { throwError } = require("../../utils");

/** @param tickerId  goes into the object key. */
exports.uploadTickerIcon = async (file, tickerId) => {
  if (!file) throwError(422, "Please upload an icon image.");

  if (!TICKER_ICON_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throwError(
      422,
      `Invalid icon file. Expected one of: ${TICKER_ICON_ALLOWED_MIME_TYPES.join(", ")}, but received "${file.mimetype}".`,
    );
  }

  const media = await storage.uploadFromPath({
    filePath: file.tempFilePath,
    originalFile: file,
    purpose: UPLOAD_PURPOSE.TICKER_ICON,
    entityId: tickerId,
  });
  return { url: media.url, storage: media.storage };
};

/** ⚠️ By stored `storage`, not by URL — see `services/storage`. */
exports.deleteTickerIcon = async (icon) => {
  try {
    if (!icon?.url) return;
    await storage.deleteAsset({ url: icon.url, storage: icon.storage });
  } catch (error) {
    console.error("Failed to delete ticker icon:", error.message);
  }
};
