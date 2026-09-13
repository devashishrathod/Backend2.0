const cloudinary = require("../../configs/cloudinary");
const CLOUD_BASE = process.env.CLOUD_BASE_URL;
const { throwError } = require("../../utils");

const isValidCloudinaryUrl = (url) => {
  if (!url || typeof url !== "string") return false;
  return url.startsWith(CLOUD_BASE) && url.includes("/upload/");
};

const extractPublicId = (url) => {
  if (!url) return null;
  try {
    let clean = url.split("?")[0];
    let afterUpload = clean.split("/upload/")[1];
    if (!afterUpload) return null;
    let parts = afterUpload.split("/");
    while (
      parts.length &&
      (parts[0].includes(",") ||
        (parts[0].startsWith("v") && !isNaN(parts[0].substring(1))))
    ) {
      parts.shift();
    }
    const last = parts.pop();
    const filename = last.split(".")[0];
    return [...parts, filename].join("/");
  } catch (err) {
    console.error("Public ID extract error:", err);
    return null;
  }
};

exports.uploadFile = async (filePath, options = {}) => {
  try {
    const result = await cloudinary.uploader.upload(filePath, options);
    // One line, not a multi-line object — this runs on every upload, which now
    // includes every subscription invoice.
    console.log(`Cloudinary uploaded: ${result.secure_url}`);
    return result;
  } catch (error) {
    console.error("Cloudinary Upload Error:", error);
    throwError(500, error.message || "Cloudinary upload failed.");
  }
};

/**
 * Delete by public id — what every row written since `storage` was added has.
 *
 * ⚠️ `deleteFile` below can only work backwards from a URL, and it gives up
 * silently on anything that does not look like a Cloudinary URL. That made
 * sense when Cloudinary was the only provider; with two providers a URL is no
 * longer proof of where the bytes are. Callers that hold a `storage` object
 * should come here instead, where the id is the id and there is nothing to
 * guess.
 */
exports.destroyPublicId = async (publicId, resourceType = "image") => {
  if (!publicId) return false;
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
    // "not found" counts: the object is gone, which is what was asked for.
    return ["ok", "not found"].includes(result.result);
  } catch (err) {
    console.error("Cloudinary Delete Error:", err);
    throwError(500, err.message || "Cloudinary delete failed.");
  }
};

exports.getOptimizedImageUrl = (publicId) => {
  return cloudinary.url(publicId, {
    fetch_format: "auto",
    quality: "auto",
  });
};

/**
 * Generic file deleter for Cloudinary
 * @param {string} cloudinaryUrl - Full Cloudinary URL
 * @param {"image"|"video"|"raw"} [resourceType="image"] - Type of resource
 */
exports.deleteFile = async (url, resourceType = "image") => {
  if (!isValidCloudinaryUrl(url)) {
    console.log("Skip delete → Not a Cloudinary URL:", url);
    return false;
  }
  const publicId = extractPublicId(url);
  if (!publicId) {
    console.warn("Invalid Cloudinary URL:", url);
    return false;
  }
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
    console.log("Cloudinary delete:", { publicId, result });
    const success = ["ok", "not found"].includes(result.result);
    return success;
  } catch (err) {
    console.error("Cloudinary Delete Error:", err);
    throwError(500, err.message || "Cloudinary delete failed.");
  }
};
