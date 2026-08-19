const { throwError } = require("../../utils");
const {
  uploadImageWithMetadata,
  deleteImage,
} = require("../../services/uploads");

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

exports.uploadVoucherImages = async (files) => {
  const uploaded = [];
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const uploadedImage = await uploadImageWithMetadata(
        file.tempFilePath,
        file,
      );
      uploaded.push({
        ...uploadedImage,
        sortOrder: index + 1,
      });
    }
    return uploaded;
  } catch (error) {
    for (const image of uploaded) {
      try {
        if (image?.url) await deleteImage(image.url);
      } catch (deleteError) {
        console.error("Voucher image rollback failed:", deleteError.message);
      }
    }
    throwError(500, "Failed to upload voucher images.");
  }
};

exports.rollbackVoucherImages = async (uploadedImages) => {
  if (!Array.isArray(uploadedImages)) return;
  for (const image of uploadedImages) {
    try {
      if (image?.url) await deleteImage(image.url);
    } catch (error) {
      console.error("Failed to rollback voucher image:", error.message);
    }
  }
};
