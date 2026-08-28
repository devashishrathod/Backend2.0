const { throwError } = require("../../utils");
const {
  resolveSectionForActor,
  normalizeSortOrder,
  validateUniqueIds,
  validateUniqueSortOrders,
  syncSectionCoverImage,
} = require("../../helpers/showcases");

/**
 * Re-number the live media of one section from a full ordered list.
 *
 * The complete list is required: positions are renumbered 1..n, so a partial
 * list would collide with the media left out of it.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 */
exports.reorderSectionMedia = async (actor, payload) => {
  let { sectionId, medias } = payload;
  if (!Array.isArray(medias) || medias.length === 0) {
    throwError(400, "Media list is required.");
  }

  // `id`, not `mediaId` — same mismatch the section reorder had. The validator
  // accepts `id` and the docs publish `id`, but every read below used
  // `mediaId`, so a well-formed request died on `undefined.toString()`.
  validateUniqueIds(medias, "id");
  validateUniqueSortOrders(medias, "sortOrder");
  medias = normalizeSortOrder(medias);

  // One read, reused — ownership and the reorder work on the same document.
  const section = await resolveSectionForActor(actor, sectionId, {
    projection: { medias: 1, coverImage: 1, coverImageMode: 1 },
  });

  const liveMedias = new Map();
  section.medias.forEach((media) => {
    if (media.isDeleted || !media.isActive) return;
    liveMedias.set(String(media._id), media);
  });

  if (liveMedias.size !== medias.length) {
    throwError(
      400,
      `Please send the complete media order — ${liveMedias.size} media expected, ${medias.length} received.`,
    );
  }

  let isModified = false;
  for (const item of medias) {
    const media = liveMedias.get(String(item.id));
    if (!media) throwError(400, `Invalid media id : ${item.id}`);
    if (media.sortOrder !== item.sortOrder) {
      media.sortOrder = item.sortOrder;
      isModified = true;
    }
  }

  if (!isModified) {
    return {
      updated: 0,
      message: "Media already in same order.",
    };
  }

  // The cover follows the first media, so it moves with the order — unless the
  // vendor pinned it (`coverImageMode: MANUAL`).
  syncSectionCoverImage(section);
  await section.save();
  return { updated: medias.length, coverImage: section.coverImage };
};
