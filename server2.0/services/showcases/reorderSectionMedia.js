const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");
//const { validateVendorBrand } = require("../../helpers/showcase/common");
const {
  normalizeSortOrder,
  validateUniqueIds,
  validateUniqueSortOrders,
  syncSectionCoverImage,
} = require("../../helpers/showcases");

exports.reorderSectionMedia = async (userId, payload) => {
  // const brand = await validateVendorBrand(userId);
  let { sectionId, medias } = payload;
  if (!Array.isArray(medias) || medias.length === 0) {
    throwError(400, "Media list is required.");
  }

  validateUniqueIds(medias, "mediaId");
  validateUniqueSortOrders(medias, "sortOrder");
  medias = normalizeSortOrder(medias);

  const section = await ShowcaseSection.findOne({
    _id: sectionId,
    isDeleted: false,
  }).select({
    medias: 1,
    coverImage: 1,
    coverImageMode: 1,
    brandId: 1,
  });

  if (!section) throwError(404, "Showcase section not found.");

  const activeMediaCount = section.medias.filter(
    (media) => media.isActive && !media.isDeleted,
  ).length;
  if (activeMediaCount !== medias.length) {
    throwError(400, "Please send complete media order.");
  }
  const activeMediaMap = new Map();
  section.medias.forEach((media) => {
    if (media.isDeleted || !media.isActive) {
      return;
    }
    activeMediaMap.set(media._id.toString(), media);
  });

  for (const item of medias) {
    if (!activeMediaMap.has(item.mediaId.toString())) {
      throwError(400, `Invalid media id : ${item.mediaId}`);
    }
  }

  const sortOrderMap = new Map();
  medias.forEach((item) => {
    sortOrderMap.set(item.mediaId.toString(), item.sortOrder);
  });

  let isModified = false;
  for (const media of section.medias) {
    if (media.isDeleted || !media.isActive) continue;
    const newSortOrder = sortOrderMap.get(media._id.toString());
    if (newSortOrder === undefined) continue;
    if (media.sortOrder !== newSortOrder) {
      media.sortOrder = newSortOrder;
      isModified = true;
    }
  }

  if (!isModified) {
    return {
      updated: 0,
      message: "Media already in same order.",
    };
  }

  syncSectionCoverImage(section);
  await section.save();
  return { updated: medias.length };
};
