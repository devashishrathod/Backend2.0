const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");
// const { validateVendorBrand } = require("../../helpers/showcase/common");
const {
  normalizeFiles,
  validateMediaFiles,
  prepareMediaDocuments,
  getExistingMediaCounts,
  getNextMediaSortOrder,
  uploadMultipleMedia,
  rollbackUploads,
} = require("../../helpers/showcases");
const { getShowcaseConfig } = require("../../helpers/settings");

exports.addSectionMedia = async (userId, payload, files) => {
  // let brand = await validateVendorBrand(userId);
  const section = await ShowcaseSection.findOne({
    _id: payload.sectionId,
    isDeleted: false,
    isActive: true,
  }).select("medias coverImage");
  if (!section) throwError(404, "Showcase section not found.");
  const uploadedFiles = normalizeFiles(files?.files);
  if (!uploadedFiles.length) {
    throwError(400, "Please upload at least one media.");
  }
  const config = await getShowcaseConfig();
  const { images, videos } = getExistingMediaCounts(section.medias);
  validateMediaFiles(uploadedFiles, config, images, videos);
  let uploaded = [];
  try {
    uploaded = await uploadMultipleMedia(uploadedFiles);
    const startSortOrder = getNextMediaSortOrder(section.medias);
    const medias = prepareMediaDocuments(
      uploaded,
      startSortOrder,
      payload.isShowInVideoClips,
    );
    let coverImage = null;
    const firstImage = medias.find((item) => item.type === "PHOTO");
    if (firstImage) coverImage = firstImage.thumbnail;
    const update = { $push: { medias: { $each: medias } } };
    if (coverImage && !section.coverImage) {
      update.$set = { coverImage };
    }
    await ShowcaseSection.updateOne({ _id: section._id }, update);
    return {
      uploaded: medias.length,
      medias,
    };
  } catch (error) {
    await rollbackUploads(uploaded);
    console.error("Error adding media to showcase section:", error);
    throwError(
      500,
      error.message || "Failed to add media to showcase section.",
    );
  }
};
