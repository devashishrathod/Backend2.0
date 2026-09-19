const ShowcaseSection = require("../../models/ShowcaseSection");

/**
 * Renumber one brand's sections dense 1..n.
 *
 * ### 🔴 What was actually wrong, once it was measured
 *
 * The first version of this phase claimed sections drifted because deleted rows
 * pushed the next number up. They did not — `createSection` had always filtered
 * `isDeleted: false` before taking the highest number, so a deleted section was
 * never counted. (That story is true of **media**: `getNextMediaSortOrder` read
 * the raw array, deleted rows included.)
 *
 * The real drift is one step removed. A deleted section left a hole in the
 * numbers of the sections that *remained* — `1, 2, 3`, delete the second, and the
 * survivors stayed at `1, 3`. The next create read the highest, answered 4, and
 * the brand listed `1, 3, 4`; delete again and it became `1, 4, 5`. The numbers
 * climbed away from the count, permanently, with nothing to pull them back.
 *
 * ### Why create calls this too, not only delete
 *
 * Every brand on the platform already carries that drift. If only delete
 * renumbered, a brand that never deletes another section would keep its holes for
 * ever — and `count + 1` on a brand holding `1, 5` would answer 3 and quietly
 * insert the new section *in front of* the old one. Running this first means the
 * next create heals the brand and the new section still lands last.
 *
 * ⚠️ Order comes from the numbers already stored, with `createdAt` breaking ties,
 * so this only ever closes gaps — it never reshuffles what the vendor arranged.
 *
 * Sections are capped by the plan (single digits), so this is a small read and,
 * on a brand that is already dense, no write at all.
 *
 * ⚠️ `bulkWrite`, not `save()` in a loop. Each section is one `$set` on one
 * document — unlike the media path there is no array being rewritten, so the
 * optimistic lock has nothing to protect here: two sections renumbering at once
 * touch two different documents.
 *
 * @param {string|ObjectId} brandId
 * @returns {Promise<number>} how many sections actually moved
 */
exports.resequenceSections = async (brandId) => {
  const sections = await ShowcaseSection.find({ brandId, isDeleted: false })
    .select("sortOrder")
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();

  const moved = sections
    .map((section, index) => ({ section, position: index + 1 }))
    .filter(({ section, position }) => section.sortOrder !== position);

  if (!moved.length) return 0;

  await ShowcaseSection.bulkWrite(
    moved.map(({ section, position }) => ({
      updateOne: {
        filter: { _id: section._id },
        update: { $set: { sortOrder: position } },
      },
    })),
    { ordered: false },
  );

  return moved.length;
};
