const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");
//const { validateBrandVendor } = require("../../helpers/brands");
const { deleteAllMedia } = require("../../helpers/showcases");

exports.deleteFullSection = async (userId, payload) => {
  // const brand = await validateVendorBrand(userId);
  const section = await ShowcaseSection.findOne(
    {
      _id: payload.sectionId,
      isDeleted: false,
    },
    { medias: 1 },
  );
  if (!section) throwError(404, "Showcase section not found.");
  try {
    await deleteAllMedia(section.medias);
  } catch (err) {
    console.error("Cloudinary delete failed:", err.message);
  }
  const updateMedia = section.medias.map((media) => {
    media.isActive = false;
    media.isDeleted = true;
    return media;
  });
  console.log(updateMedia);
  section.medias = updateMedia;
  section.isActive = false;
  section.isDeleted = true;
  await section.save();
  return { deletedSectionId: payload.sectionId, deletedMediaIds: updateMedia };
};
