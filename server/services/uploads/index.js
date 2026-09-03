const fs = require("fs");
const {
  uploadFile,
  deleteFile,
  getOptimizedImageUrl,
} = require("../../helpers/cloudinary");

exports.uploadImage = async (imagePath) => {
  const result = await uploadFile(imagePath, {
    resource_type: "image",
    folder: "Images",
  });
  return getOptimizedImageUrl(result.public_id);
};

exports.uploadAudio = async (audioPath) => {
  const result = await uploadFile(audioPath, {
    resource_type: "video",
    folder: "Audio",
  });
  return result.secure_url;
};

exports.uploadVideo = async (videoPath) => {
  const result = await uploadFile(videoPath, {
    resource_type: "video",
    folder: "Videos",
  });
  return result.secure_url;
};

exports.uploadPDF = async (pdfPath, fileName) => {
  const result = await uploadFile(pdfPath, {
    resource_type: "auto",
    folder: "Documents",
    public_id: fileName.replace(".pdf", ""),
  });
  if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
  // Was dumping the entire Cloudinary response. This now runs on every
  // subscription payment, so it is trimmed to the one useful line.
  console.log(`PDF uploaded: ${result.secure_url}`);
  return result.secure_url;
};

exports.deleteImage = async (url) => deleteFile(url, "image");
exports.deleteAudioOrVideo = async (url) => deleteFile(url, "video");
exports.deletePDF = async (url) => deleteFile(url, "raw");

exports.uploadImageWithMetadata = async (imagePath, originalFile) => {
  const result = await uploadFile(imagePath, {
    resource_type: "image",
    folder: "Images",
  });
  return {
    url: getOptimizedImageUrl(result.public_id),
    thumbnail: getOptimizedImageUrl(result.public_id),
    storage: {
      provider: "CLOUDINARY",
      publicId: result.public_id,
      bucket: null,
      key: null,
    },
    metadata: {
      originalName: originalFile.name,
      mimeType: originalFile.mimetype,
      format: result.format,
      size: result.bytes,
      width: result.width,
      height: result.height,
      duration: 0,
    },
  };
};

exports.uploadVideoWithMetadata = async (videoPath, originalFile) => {
  const result = await uploadFile(videoPath, {
    resource_type: "video",
    folder: "Videos",
  });
  return {
    url: result.secure_url,
    thumbnail: getOptimizedImageUrl(result.public_id),
    storage: {
      provider: "CLOUDINARY",
      publicId: result.public_id,
      bucket: null,
      key: null,
    },
    metadata: {
      originalName: originalFile.name,
      mimeType: originalFile.mimetype,
      format: result.format,
      size: result.bytes,
      width: result.width,
      height: result.height,
      duration: result.duration || 0,
    },
  };
};
