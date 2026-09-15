const storage = require("../../services/storage");
const {
  UPLOAD_PURPOSE,
  MEDIA_KIND,
  kindFromMime,
} = require("../../constants/storage");
const {
  TICKER_ICON_ALLOWED_MIME_TYPES,
} = require("../../constants/promotionalTicker");
const { toMediaDocument } = require("../media");
const { throwError } = require("../../utils");

/**
 * Upload a ticker's icon.
 *
 * ⚠️ The mime allow-list stays, and it is narrower than "is this an image".
 * A ticker icon is rendered inline at a fixed small size in a scrolling strip —
 * an animated GIF there is a distraction nobody asked for, and a video has no
 * player to run in. `kindFromMime` then decides the object's prefix, which is
 * what keeps the file away from a resize step it does not want.
 *
 * @param file      the icon file from `req.files`
 * @param tickerId  goes into the object key, so the file can be traced back to
 *                  its row
 * @returns {Promise<object>} a `mediaSchema` value
 */
exports.uploadTickerIcon = async (file, tickerId) => {
  if (!file) throwError(422, "Please upload an icon image.");

  if (!TICKER_ICON_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throwError(
      422,
      `Invalid icon file. Expected one of: ${TICKER_ICON_ALLOWED_MIME_TYPES.join(", ")}, but received "${file.mimetype}".`,
    );
  }

  const uploaded = await storage.uploadFromPath({
    filePath: file.tempFilePath,
    originalFile: file,
    purpose: UPLOAD_PURPOSE.TICKER_ICON,
    entityId: tickerId,
    kind: MEDIA_KIND.IMAGE,
  });

  /**
   * ⚠️ `kind` is passed explicitly rather than derived. The allow-list above has
   * already refused everything that is not a still image, so there is nothing
   * left to infer — and an explicit kind is what stops a future mime type
   * slipping through as something the strip cannot render.
   */
  return toMediaDocument(uploaded, { kind: MEDIA_KIND.IMAGE });
};

/** ⚠️ By stored `storage`, not by URL — see `services/storage`. */
exports.deleteTickerIcon = async (icon) => {
  try {
    if (!icon?.url && !icon?.storage) return;
    await storage.deleteAsset({ url: icon.url, storage: icon.storage });
  } catch (error) {
    console.error("Failed to delete ticker icon:", error.message);
  }
};
