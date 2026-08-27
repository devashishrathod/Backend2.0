const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");
// const { validateVendorBrand } = require("../../helpers/showcase/common");
const { deleteMedia } = require("../../helpers/showcases");
const {
  resolveSectionForActor,
} = require("../../helpers/showcases");

exports.deleteSectionMedia = async (actor, payload) => {
  await resolveSectionForActor(actor, payload.sectionId, {
    projection: { brandId: 1 },
  });

  // const brand = await validateVendorBrand(userId);
  const section = await ShowcaseSection.findOne(
    {
      _id: payload.sectionId,
      "medias._id": payload.mediaId,
      isDeleted: false,
    },
    { coverImage: 1, medias: 1 },
  );

  if (!section) throwError(404, "Media not found.");

  const findMediaById = (medias, mediaId) => {
    return medias.find((item) => item._id.toString() === mediaId);
  };

  const media = findMediaById(section.medias, payload.mediaId);

  if (!media || media.isDeleted || !media.isActive) {
    throwError(404, "Media not found.");
  }

  const activeMedias = section.medias
    .filter((item) => item.isActive && !item.isDeleted)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (activeMedias.length <= 1) {
    throwError(400, "At least one media is required in this section.");
  }

  let nextCoverImage = section.coverImage;

  if (section.coverImage === media.url) {
    const nextMedia = activeMedias.find(
      (item) => item._id.toString() !== payload.mediaId,
    );
    nextCoverImage = nextMedia ? nextMedia.url : null;
  }

  const update = { $pull: { medias: { _id: payload.mediaId } } };

  if (nextCoverImage !== section.coverImage) {
    update.$set = { coverImage: nextCoverImage };
  }

  const result = await ShowcaseSection.updateOne(
    { _id: payload.sectionId, "medias._id": payload.mediaId, isDeleted: false },
    update,
  );

  if (!result.modifiedCount) throwError(500, "Failed to delete media.");

  try {
    await deleteMedia(media);
  } catch (err) {
    console.error("Cloudinary delete failed:", err.message);
  }
  return {
    deletedMediaId: media._id,
    coverImage: nextCoverImage,
  };
};
