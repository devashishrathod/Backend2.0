const ShowcaseSection = require("../../models/ShowcaseSection");
const { toDisplayName } = require("../../helpers/common");
const { escapeRegex } = require("../../validator/common");
const { throwError } = require("../../utils");
const { SHOWCASE_SECTION_TYPE } = require("../../constants/showcase");
const {
  generateUniqueSlug,
  formatSectionSummary,
  resequenceSections,
} = require("../../helpers/showcases");
const {
  resolveActorBrand,
  reserveSlot,
  releaseSlot,
} = require("../../helpers/brands");
const { assertActiveSubscription } = require("../../helpers/subscribeds");
const { ENTITLEMENT_BUCKETS } = require("../../constants/subscription");

/**
 * @param {{ userId: string, role: string, brandId?: string }} actor
 * @param {object} payload  may carry `brandId` — required when the actor is an
 *                          admin, ignored-then-verified for a vendor.
 */
exports.createSection = async (actor, payload) => {
  // Was `validateBrandVendor(userId)`, which resolved the brand from the token
  // and so could only ever work for a vendor. `resolveActorBrand` keeps that
  // behaviour for vendors and lets an admin name the brand they are acting for.
  const brand = await resolveActorBrand(actor, payload.brandId);

  // A showcase section is a metered plan feature, same as an outlet. The
  // subscription gate runs first so a vendor with no live plan is told to
  // subscribe rather than getting a validation error about the section.
  await assertActiveSubscription(brand._id);

  // The title is stored as the vendor typed it — it is what the customer app
  // renders. It used to be lowercased on the way in, which is why every album
  // on the brand profile read "ambience" instead of "Ambience". Uniqueness is
  // still case-insensitive, so "Ambience" and "ambience" cannot coexist.
  const title = toDisplayName(payload.title);

  const exists = await ShowcaseSection.exists({
    brandId: brand._id,
    isDeleted: false,
    title: {
      $regex: new RegExp(`^${escapeRegex(title)}$`, "i"),
    },
  });
  if (exists) throwError(409, "Section title already exists.");

  const slug = await generateUniqueSlug(brand._id, title);

  /**
   * ---------------- where this section goes in the brand's list ----------------
   *
   * 🔴 The old rule was `last.sortOrder + 1`, and it only ever climbed.
   *
   * ⚠️ Not because deleted sections were counted — that query already filtered
   * `isDeleted: false`, and assuming otherwise is a mistake this phase made and a
   * mutant caught. (It *is* true of media: `getNextMediaSortOrder` read the raw
   * array, deleted rows included.)
   *
   * It climbed because a delete left a hole in the numbers of the sections that
   * **remained**: `1, 2, 3` minus the second stayed `1, 3`, the next create read
   * the highest and answered 4, and the brand listed `1, 3, 4`. Delete again and
   * it was `1, 4, 5` — the numbers walking away from the count for good.
   *
   * Resequencing first is what makes this safe on the brands that already carry
   * that drift. `count + 1` alone on a brand holding `1, 5` would answer 3 and
   * slot the new section *in front of* the old one; dense first, and the new
   * section lands last where the vendor expects it.
   */
  await resequenceSections(brand._id);
  const sortOrder =
    (await ShowcaseSection.countDocuments({
      brandId: brand._id,
      isDeleted: false,
    })) + 1;

  // Claimed as late as possible — after the duplicate-title and slug checks —
  // so a rejected request never consumes a slot. The claim itself is an atomic
  // conditional increment, so two concurrent creates cannot both take the last.
  await reserveSlot(brand._id, ENTITLEMENT_BUCKETS.SHOWCASE);

  try {
    // The three toggles are accepted by the validator, and were being dropped
    // here — a vendor who created a section as hidden got a visible one.
    const section = await ShowcaseSection.create({
      brandId: brand._id,
      title,
      slug,
      description: payload.description?.trim(),
      sortOrder,
      sectionType: payload.sectionType || SHOWCASE_SECTION_TYPE.CUSTOM,
      ...(payload.isActive !== undefined && { isActive: payload.isActive }),
      ...(payload.isVisible !== undefined && { isVisible: payload.isVisible }),
      ...(payload.isShowVideosInClips !== undefined && {
        isShowVideosInClips: payload.isShowVideosInClips,
      }),
    });
    return formatSectionSummary(section);
  } catch (error) {
    // Give the slot back rather than letting a failed insert eat it.
    await releaseSlot(brand._id, ENTITLEMENT_BUCKETS.SHOWCASE);
    throw error;
  }
};
