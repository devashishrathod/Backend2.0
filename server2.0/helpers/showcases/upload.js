const { SHOWCASE_MEDIA_TYPE } = require("../../constants/showcase");
const { getOptimizedImageUrl } = require("../cloudinary");
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

/**
 * Did the vendor upload this thumbnail themselves?
 *
 * A PHOTO's thumbnail *is* its own delivery URL, and a VIDEO's default poster is
 * a transformation of the video's own public id — destroying either of those
 * would take the media itself down with it. Only a separately uploaded poster
 * is safe to delete, and this is how the two are told apart.
 */
exports.isCustomThumbnail = (media) => {
  const thumbnail = media?.thumbnail;
  if (!thumbnail || thumbnail === media.url) return false;

  const publicId = media?.storage?.publicId;
  if (publicId && thumbnail === getOptimizedImageUrl(publicId)) return false;

  return true;
};

/**
 * Delete a thumbnail the vendor uploaded, and only that.
 *
 * `updateSectionMedia` guarded this with `if (thumbnail.image)` — a property no
 * upload object has — so the old poster was never actually removed and every
 * thumbnail change left an orphan asset behind on Cloudinary.
 */
exports.deleteCustomThumbnail = async (media) => {
  if (!exports.isCustomThumbnail(media)) return false;
  try {
    return await deleteImage(media.thumbnail);
  } catch (error) {
    // Best effort: an orphaned poster is not worth failing the request over.
    console.error("Old thumbnail delete failed:", error.message);
    return false;
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
