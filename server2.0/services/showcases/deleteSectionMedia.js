const { throwError } = require("../../utils");
const {
  resolveSectionForActor,
  deleteMedia,
  deleteCustomThumbnail,
  syncSectionCoverImage,
} = require("../../helpers/showcases");

/**
 * Remove one media from a section.
 *
 * Soft delete, matching the rest of the platform: the row stays with
 * `isDeleted: true` so the section keeps a record of what it used to hold. It
 * used to `$pull` the subdocument out of the array — a hard delete of domain
 * data, and the only one left in this domain.
 *
 * The Cloudinary asset is still destroyed, because a removed photo should stop
 * costing storage. So this is an audit trail, not a restore point.
 *
 * A section must keep at least one live media; use the section delete endpoint
 * to remove the album itself.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 */
exports.deleteSectionMedia = async (actor, payload) => {
  const section = await resolveSectionForActor(actor, payload.sectionId, {
    projection: { medias: 1, coverImage: 1, coverImageMode: 1 },
  });

  const media = section.medias.id(payload.mediaId);
  if (!media || media.isDeleted || !media.isActive) {
    throwError(404, "Media not found.");
  }

  const liveCount = section.medias.filter(
    (item) => item.isActive && !item.isDeleted,
  ).length;
  if (liveCount <= 1) {
    throwError(400, "At least one media is required in this section.");
  }

  const removed = media.toObject();

  media.isActive = false;
  media.isDeleted = true;
  media.deletedAt = new Date();

  // Recomputed from what is left, rather than compared field by field. The old
  // code tested `coverImage === media.url`, while the cover had been written
  // from `thumbnail` — so deleting the cover media often left the section
  // pointing at a dead asset.
  syncSectionCoverImage(section);

  await section.save();

  try {
    await deleteCustomThumbnail(removed);
    await deleteMedia(removed);
  } catch (err) {
    console.error("Cloudinary delete failed:", err.message);
  }

  return {
    deletedMediaId: removed._id,
    coverImage: section.coverImage,
  };
};
