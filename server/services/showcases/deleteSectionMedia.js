const { throwError } = require("../../utils");
const {
  resolveSectionForActor,
  deleteMedia,
  resequenceMedias,
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
    projection: { medias: 1, coverImage: 1, coverImageMode: 1, coverMediaId: 1 },
  });

  const item = section.medias.id(payload.mediaId);
  if (!item || item.isDeleted || !item.isActive) {
    throwError(404, "Media not found.");
  }

  const liveCount = section.medias.filter(
    (entry) => entry.isActive && !entry.isDeleted,
  ).length;
  if (liveCount <= 1) {
    throwError(400, "At least one media is required in this section.");
  }

  const removed = item.toObject();

  item.isActive = false;
  item.isDeleted = true;
  item.deletedAt = new Date();

  /**
   * 🔴 The gap is closed here, not left for the next reorder.
   *
   * A delete used to leave the removed media's position behind — three photos at
   * 1, 2, 3, delete the middle one, and the panel showed `1, 3`. The vendor had
   * no way to fix it except a full drag-and-drop reorder, and `getNextMediaSortOrder`
   * kept counting from the highest number, so the drift grew with every delete.
   *
   * The removed row keeps the number it had (S-5): it is an audit record and is
   * not counted, and a deleted row at `sortOrder: 0` would sort in front of
   * everything the moment anybody read the raw array.
   */
  resequenceMedias(section.medias);

  // Recomputed from what is left, rather than compared field by field. The old
  // code tested `coverImage === media.url`, while the cover had been written
  // from `thumbnail` — so deleting the cover media often left the section
  // pointing at a dead asset.
  syncSectionCoverImage(section);

  await section.save();

  try {
    // Takes the poster with it. This used to need a separate
    // `deleteCustomThumbnail` call guarded by a check that could not work on S3.
    await deleteMedia(removed.media);
  } catch (err) {
    console.error("Storage delete failed:", err.message);
  }

  return {
    deletedMediaId: removed._id,
    coverImage: section.coverImage,
  };
};
