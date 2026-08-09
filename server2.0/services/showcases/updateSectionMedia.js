const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");
const { uploadImage, deleteImage } = require("../uploads");
// const { deleteMedia } = require("../../helpers/showcases");
//const { validateVendorBrand } = require("../../helpers/showcase/common");

exports.updateSectionMedia = async (userId, payload, thumbnail) => {
  //  const brand = await validateVendorBrand(userId);
  const {
    sectionId,
    mediaId,
    title,
    altText,
    isShowInVideoClips,
    sortOrder,
    isActive,
  } = payload;
  const sectionMedia = await ShowcaseSection.findOne(
    { _id: sectionId, "medias._id": mediaId },
    { medias: { $elemMatch: { _id: mediaId } } },
  );
  if (!sectionMedia) throwError(404, "Media not found.");

  const update = {};
  if (title) update["medias.$.title"] = title.trim();
  if (altText) update["medias.$.altText"] = altText.trim();
  if (sortOrder) update["medias.$.sortOrder"] = sortOrder;
  if (isActive !== undefined) update["medias.$.isActive"] = isActive;
  if (isShowInVideoClips !== undefined) {
    update["medias.$.isShowInVideoClips"] = isShowInVideoClips;
  }
  if (thumbnail) {
    console.log("thumbnail", sectionMedia.medias[0].thumbnail);
    try {
      if (thumbnail.image) await deleteImage(sectionMedia.medias[0].thumbnail);
    } catch (error) {
      console.error("Error deleting image:", error);
    }
    try {
      update["medias.$.thumbnail"] = await uploadImage(thumbnail.tempFilePath);
    } catch (error) {
      console.error("Error uploading image:", error);
    }
  }
  const result = await ShowcaseSection.updateOne(
    { _id: sectionId, isDeleted: false, "medias._id": mediaId },
    { $set: update },
  );
  if (!result.matchedCount) throwError(404, "Media not found.");
  const section = await ShowcaseSection.findOne(
    { _id: sectionId, "medias._id": mediaId },
    { medias: { $elemMatch: { _id: mediaId } } },
  );
  return section.medias[0];
};
