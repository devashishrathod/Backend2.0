const { SHOWCASE_MEDIA_TYPE } = require("../../constants/showcase");
const {
  uploadImageWithMetadata,
  uploadVideoWithMetadata,
  deleteImage,
  deleteAudioOrVideo,
} = require("../../services/uploads");
const { throwError } = require("../../utils");

exports.uploadSingleMedia = async (file) => {
  if (!file) throwError(400, "Media file is required.");
  if (file.mimetype.startsWith("image")) {
    const media = await uploadImageWithMetadata(file.tempFilePath, file);
    return {
      type: SHOWCASE_MEDIA_TYPE.PHOTO,
      ...media,
    };
  }
  if (file.mimetype.startsWith("video")) {
    const media = await uploadVideoWithMetadata(file.tempFilePath, file);
    return {
      type: SHOWCASE_MEDIA_TYPE.VIDEO,
      ...media,
    };
  }
  throwError(400, "Unsupported media type.");
};

exports.uploadMultipleMedia = async (files = []) => {
  const uploaded = [];
  for (const file of files) {
    const media = await exports.uploadSingleMedia(file);
    uploaded.push(media);
  }
  return uploaded;
};

exports.deleteMedia = async (media) => {
  try {
    if (!media) return;
    const provider = media?.storage?.provider;
    switch (provider) {
      case "CLOUDINARY": {
        if (media.type === SHOWCASE_MEDIA_TYPE.PHOTO) {
          return await deleteImage(media.url);
        }
        if (media.type === SHOWCASE_MEDIA_TYPE.VIDEO) {
          return await deleteAudioOrVideo(media.url);
        }
        return;
      }
      case "S3": {
        // Future Implementation
        // await deleteFromS3(media.storage.key);
        return;
      }
      default:
        console.warn(`Unknown storage provider: ${provider}`);
        return;
    }
  } catch (error) {
    console.error(`Failed to delete media: ${media?.url}`, error.message);
  }
};

exports.deleteAllMedia = async (medias = []) => {
  const results = await Promise.allSettled(
    medias.map((media) => exports.deleteMedia(media)),
  );
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(
        `Media Delete Failed (${medias[index]._id})`,
        result.reason,
      );
    }
  });
};

exports.rollbackUploads = async (uploadedMedias = []) => {
  if (!uploadedMedias.length) return;
  await Promise.allSettled(
    uploadedMedias.map((media) => exports.deleteMedia(media)),
  );
};
