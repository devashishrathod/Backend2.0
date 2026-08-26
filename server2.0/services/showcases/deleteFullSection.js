const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");
//const { validateBrandVendor } = require("../../helpers/brands");
const { deleteAllMedia } = require("../../helpers/showcases");
const { releaseSlot } = require("../../helpers/brands");
const { ENTITLEMENT_BUCKETS } = require("../../constants/subscription");
const {
  resolveSectionForActor,
} = require("../../helpers/showcases");

exports.deleteFullSection = async (actor, payload) => {
  await resolveSectionForActor(actor, payload.sectionId, {
    projection: { brandId: 1 },
  });

  // const brand = await validateVendorBrand(userId);
  const section = await ShowcaseSection.findOne(
    {
      _id: payload.sectionId,
      isDeleted: false,
    },
    { medias: 1, brandId: 1 },
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
  section.medias = updateMedia;
  section.isActive = false;
  section.isDeleted = true;
  await section.save();

  // Deleting a section frees its slot in the plan's showcase pool.
  await releaseSlot(section.brandId, ENTITLEMENT_BUCKETS.SHOWCASE);

  return { deletedSectionId: payload.sectionId, deletedMediaIds: updateMedia };
};
