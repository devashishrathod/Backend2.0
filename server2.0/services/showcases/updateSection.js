const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");
const { generateUniqueSlug } = require("../../helpers/showcases");
const { escapeRegex } = require("../../validator/common");

exports.updateSection = async (payload) => {
  const section = await ShowcaseSection.findOne({
    _id: payload.sectionId,
    isDeleted: false,
  });

  if (!section) throwError(404, "Showcase section not found.");

  if (payload.title) {
    payload.title = payload.title.toLowerCase().trim();

    const exists = await ShowcaseSection.exists({
      _id: { $ne: section._id },
      brandId: section.brandId,
      isDeleted: false,
      title: {
        $regex: new RegExp(`^${escapeRegex(payload.title)}$`, "i"),
      },
    });
    if (exists) throwError(409, "Section title already exists.");

    section.title = payload.title;
    section.slug = await generateUniqueSlug(
      section.brandId,
      payload.title,
      section._id,
    );
  }

  if (payload.description) section.description = payload.description?.trim();
  if (payload.sectionType) section.sectionType = payload.sectionType;
  if (payload.sortOrder) section.sortOrder = payload.sortOrder;
  if (payload.isActive !== undefined) section.isActive = payload.isActive;
  if (payload.isVisible !== undefined) section.isVisible = payload.isVisible;
  if (payload.isShowVideosInClips !== undefined) {
    section.isShowVideosInClips = payload.isShowVideosInClips;
  }
  await section.save();
  return section;
};
