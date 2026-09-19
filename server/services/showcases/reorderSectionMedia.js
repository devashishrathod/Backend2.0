const { throwError } = require("../../utils");
const {
  resolveSectionForActor,
  syncSectionCoverImage,
} = require("../../helpers/showcases");
const {
  normalizeSortOrder,
  validateUniqueIds,
  validateUniqueSortOrders,
} = require("../../helpers/common");

/**
 * Re-number one section's media from a full ordered list.
 *
 * The complete list is required: positions are renumbered 1..n, so a partial
 * list would collide with the media left out of it.
 *
 * ### 🔴 Every non-deleted media, not just the visible ones
 *
 * This used to renumber only media that were `isActive && !isDeleted`, and left
 * hidden ones holding whatever number they had before. Hide media #2, reorder
 * the rest, and the survivors were renumbered 1, 2, 3 — with the hidden one
 * *also* at 2. Switch it back on and two media share a position, so which one
 * comes first is whatever order Mongo happens to return.
 *
 * Hidden is not deleted. The stored order covers everything the vendor can still
 * see in their own panel (S-12), which is also what the section reorder endpoint
 * has always done — the two are symmetrical now (S-14).
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
    projection: { medias: 1, coverImage: 1, coverImageMode: 1, coverMediaId: 1 },
  });

  const orderable = new Map();
  section.medias.forEach((media) => {
    if (media.isDeleted) return;
    orderable.set(String(media._id), media);
  });

  if (orderable.size !== medias.length) {
    throwError(
      400,
      `Please send the complete media order — ${orderable.size} media expected, ${medias.length} received.`,
    );
  }

  let isModified = false;
  for (const item of medias) {
    const media = orderable.get(String(item.id));
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
