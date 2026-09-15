const {
  deleteAllMedia,
  resolveSectionForActor,
} = require("../../helpers/showcases");
const { releaseSlot } = require("../../helpers/brands");
const { ENTITLEMENT_BUCKETS } = require("../../constants/subscription");

/**
 * Soft-delete a section and everything in it.
 *
 * The Cloudinary assets are destroyed for real — a deleted album should stop
 * costing storage — so the soft delete is an audit record, not a restore point.
 * A failure there must not block the delete, hence the swallowed error.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 */
exports.deleteFullSection = async (actor, payload) => {
  // One read, reused: this used to resolve ownership and then fetch the same
  // section again for its media.
  const section = await resolveSectionForActor(actor, payload.sectionId, {
    projection: { medias: 1 },
  });

  try {
    // The files, not the gallery entries — and `deleteAllMedia` takes each
    // video's poster along with it.
    await deleteAllMedia(section.medias.map((item) => item.media));
  } catch (err) {
    console.error("Storage delete failed:", err.message);
  }

  const deletedAt = new Date();
  const deletedMediaIds = section.medias.map((media) => media._id);

  section.medias.forEach((media) => {
    media.isActive = false;
    media.isDeleted = true;
    media.deletedAt = deletedAt;
  });
  section.isActive = false;
  section.isDeleted = true;
  await section.save();

  // Deleting a section frees its slot in the plan's showcase pool.
  await releaseSlot(section.brandId, ENTITLEMENT_BUCKETS.SHOWCASE);

  // Ids, not whole documents. This used to return the media subdocuments under
  // a key called `deletedMediaIds`.
  return { deletedSectionId: section._id, deletedMediaIds };
};
