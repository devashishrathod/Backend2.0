const { throwError } = require("../../utils");
const storage = require("../../services/storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

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
  for (const file of images) {
    const mimeType = file.mimetype || file.mimeType;
    if (!mimeType || !mimeType.startsWith("image/")) {
      throwError(400, "Only image files are allowed for voucher images.");
    }
  }
  // const sortOrders = images.map((item) => item.sortOrder);
  // if (new Set(sortOrders).size !== sortOrders.length) {
  //   throwError(400, "Duplicate image sort order is not allowed.");
  // }
  return images;
};

/** @param voucherId  goes into the object key. */
exports.uploadVoucherImages = async (files, voucherId) => {
  const uploaded = [];
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const uploadedImage = await storage.uploadFromPath({
        filePath: file.tempFilePath,
        originalFile: file,
        purpose: UPLOAD_PURPOSE.VOUCHER_IMAGE,
        entityId: voucherId,
      });
      uploaded.push({
        ...uploadedImage,
        sortOrder: index + 1,
      });
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
