const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");
const { escapeRegex } = require("../../validator/common");
const { SHOWCASE_COVER_IMAGE_MODE } = require("../../constants/showcase");
const {
  resolveSectionForActor,
  generateUniqueSlug,
  formatSectionSummary,
  getMediaCoverImage,
  syncSectionCoverImage,
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

  /**
   * ---------------- the cover: pinned, or following the media ----------------
   *
   * `coverImageMode: MANUAL` was honoured by `syncSectionCoverImage` from the
   * day it was written, but **nothing could set it** — no endpoint touched the
   * field, so every section was AUTO for ever and a vendor could not choose
   * which picture represented their section. This is the missing half.
   */
  if (payload.coverMediaId !== undefined) {
    const media = section.medias.id(payload.coverMediaId);

    // ⚠️ Checked against this section's own media, so a mediaId copied from
    // another section — or another brand's — cannot become this section's cover.
    if (!media || media.isDeleted) {
      throwError(404, "That media is not in this section.");
    }
    /**
     * A hidden media cannot be the cover. It would show the customer a picture
     * that is deliberately not in the gallery, and the moment `syncSectionCoverImage`
     * ran for any other reason the cover would jump somewhere else anyway.
     */
    if (!media.isActive) {
      throwError(422, "A hidden media cannot be the cover. Show it first.");
    }

    section.coverImage = getMediaCoverImage(media);
    section.coverImageMode = SHOWCASE_COVER_IMAGE_MODE.MANUAL;
    // The id, not just the URL — so the pin survives that media being replaced
    // and can be noticed when it is deleted.
    section.coverMediaId = media._id;
  } else if (payload.coverImageMode === SHOWCASE_COVER_IMAGE_MODE.AUTO) {
    // Unpin. Recomputed here rather than left for the next add or reorder, so
    // the vendor sees the answer in this response.
    section.coverImageMode = SHOWCASE_COVER_IMAGE_MODE.AUTO;
    section.coverMediaId = undefined;
    syncSectionCoverImage(section);
  }

  await section.save();
  return formatSectionSummary(section);
};
