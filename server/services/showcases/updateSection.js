const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");
const { escapeRegex } = require("../../validator/common");
const {
  resolveSectionForActor,
  generateUniqueSlug,
  formatSectionSummary,
} = require("../../helpers/showcases");

/**
 * Edit one section's metadata and its three switches.
 *
 * `isVisible` is the one that matters most to the customer: turning it off
 * removes the section from the brand profile and from the full gallery, while
 * leaving it in the vendor's own list so it can be turned back on.
 * `isShowVideosInClips` only affects the reels feed.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 */
exports.updateSection = async (actor, payload) => {
  // Returns the document, so the second identical `findOne` this service used
  // to run is gone.
  const section = await resolveSectionForActor(actor, payload.sectionId);

  if (payload.title !== undefined) {
    const title = payload.title.trim();

    const exists = await ShowcaseSection.exists({
      _id: { $ne: section._id },
      brandId: section.brandId,
      isDeleted: false,
      title: {
        $regex: new RegExp(`^${escapeRegex(title)}$`, "i"),
      },
    });
    if (exists) throwError(409, "Section title already exists.");

    section.title = title;
    // `section._id` is excluded from the uniqueness scan, so re-saving the same
    // title keeps the same slug instead of drifting to `-2`, `-3`, …
    section.slug = await generateUniqueSlug(section.brandId, title, section._id);
  }

  // `!== undefined` rather than truthiness — a vendor clearing the description
  // sends `""`, which the old truthy check silently ignored.
  if (payload.description !== undefined) {
    section.description = payload.description.trim();
  }
  if (payload.sectionType !== undefined) {
    section.sectionType = payload.sectionType;
  }
  if (payload.sortOrder !== undefined) section.sortOrder = payload.sortOrder;
  if (payload.isActive !== undefined) section.isActive = payload.isActive;
  if (payload.isVisible !== undefined) section.isVisible = payload.isVisible;
  if (payload.isShowVideosInClips !== undefined) {
    section.isShowVideosInClips = payload.isShowVideosInClips;
  }

  await section.save();
  return formatSectionSummary(section);
};
