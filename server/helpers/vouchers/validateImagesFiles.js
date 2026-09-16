const { throwError } = require("../../utils");
const storage = require("../../services/storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");
const { assertImageFile, toMediaDocument } = require("../media");

exports.normalizeVoucherImages = (files) => {
  if (!files) return [];
  let images = files;
  if (files.files !== undefined) images = files.files;
  if (!Array.isArray(images)) images = [images];
  return images.filter(Boolean);
};

exports.validateVoucherImages = (files, maxImages = 5) => {
  const images = exports.normalizeVoucherImages(files);
  if (images.length > maxImages) {
    throwError(400, `Maximum ${maxImages} voucher images are allowed.`);
  }
  /**
   * 🔴 This was `mimeType.startsWith("image/")`, which `image/svg+xml` passes.
   *
   * An SVG is an XML document and can carry a `<script>`. It survives today
   * only because these are served from a Cloudinary domain, where a panel
   * session is cross-origin and out of reach — and that protection disappears
   * the moment media moves to our own CDN. An explicit allow-list has no such
   * dependency on where the file happens to be hosted.
   */
  for (const file of images) {
    assertImageFile(file, "Voucher image");
  }
  // const sortOrders = images.map((item) => item.sortOrder);
  // if (new Set(sortOrders).size !== sortOrders.length) {
  //   throwError(400, "Duplicate image sort order is not allowed.");
  // }
  return images;
};

/**
 * @param voucherId  goes into the object key.
 * @returns {Promise<Array>} `mediaSchema` values, in the order the files came
 *
 * ⚠️ No `sortOrder` here any more. It used to be stamped onto the upload result,
 * which mixed "what this file is" with "where it sits in the gallery" — the two
 * things M-5 pulled apart. The caller assigns positions when it builds the
 * image rows, and it is the only place that knows about the images already
 * there.
 */
exports.uploadVoucherImages = async (files, voucherId) => {
  const uploaded = [];
  try {
    for (const file of files) {
      const uploadedImage = await storage.uploadFromPath({
        filePath: file.tempFilePath,
        originalFile: file,
        purpose: UPLOAD_PURPOSE.VOUCHER_IMAGE,
        entityId: voucherId,
      });
      uploaded.push(toMediaDocument(uploadedImage));
    }
    return uploaded;
  } catch (error) {
    // 🔴 Rollback used to delete by URL, which meant `deleteFile` compared the
    // URL against `CLOUD_BASE_URL` and quietly gave up on anything that did not
    // match. Every image uploaded before the failure then stayed on storage
    // forever, paid for and unreferenced. The upload result already carries its
    // `storage`, so the delete now follows that.
    await storage.deleteAssets(uploaded);
    // The original failure was being thrown away, so "Failed to upload voucher
    // images" was the only trace of a quota, a credential or a network error.
    console.error("Voucher image upload failed:", error.message);
    throwError(500, "Failed to upload voucher images.");
  }
};

exports.rollbackVoucherImages = async (uploadedImages) => {
  if (!Array.isArray(uploadedImages)) return;
  await storage.deleteAssets(uploadedImages);
};
