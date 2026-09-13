const { IMAGE_MIME_TYPES } = require("../../constants/storage");
const { throwError } = require("../../utils");

/**
 * "Is this an image?" — for the surfaces that never asked.
 *
 * Six upload paths handed the file straight to the provider with no check at
 * all: the avatar on register and profile update, the brand logo, the brand
 * feature icon, and the category / subcategory images. Cloudinary happened to
 * refuse a non-image because the upload named `resource_type: "image"` — but
 * that is an accident of the provider, not a rule of ours, and it produces the
 * wrong answer anyway.
 *
 * 🔴 **What the vendor saw:** they attached a PDF to the logo field by mistake
 * and got `500 Something went wrong, please try again`. Nothing in that message
 * says the file is the problem, so they retried the same PDF three or four
 * times and then wrote to support. The right sentence — *"Logo must be a JPG,
 * PNG, WebP or GIF image"* — was never said.
 *
 * Banner, ticker, showcase and voucher-banner already answer with a clean 422
 * naming the accepted types. This gives the other six the same manners.
 *
 * @param file   an `express-fileupload` file, or nothing
 * @param label  what the caller is uploading, used in the message ("Logo")
 */
exports.assertImageFile = (file, label = "File") => {
  if (!file) return;

  const mime = String(file.mimetype || file.mimeType || "").toLowerCase();
  if (IMAGE_MIME_TYPES.includes(mime)) return;

  throwError(
    422,
    `${label} must be an image — ${IMAGE_MIME_TYPES.join(", ")}. ` +
      `Received "${mime || "no content type"}".`,
  );
};
