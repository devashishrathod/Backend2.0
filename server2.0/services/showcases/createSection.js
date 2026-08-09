const ShowcaseSection = require("../../models/ShowcaseSection");
const { escapeRegex } = require("../../validator/common");
const { throwError } = require("../../utils");
const { SHOWCASE_SECTION_TYPE } = require("../../constants/showcase");
const { generateUniqueSlug } = require("../../helpers/showcases");
const { validateBrandVendor } = require("../../helpers/brands");

exports.createSection = async (userId, payload) => {
  const brand = await validateBrandVendor(userId);

  payload.title = payload.title.toLowerCase().trim();
  const exists = await ShowcaseSection.exists({
    brandId: brand._id,
    isDeleted: false,
    title: {
      $regex: new RegExp(`^${escapeRegex(payload.title)}$`, "i"),
    },
  });
  if (exists) throwError(409, "Section title already exists.");

  const slug = await generateUniqueSlug(brand._id, payload.title);
  let sortOrder = payload.sortOrder;

  if (!sortOrder) {
    const last = await ShowcaseSection.findOne({
      brandId: brand._id,
      isDeleted: false,
    })
      .sort({ sortOrder: -1 })
      .select("sortOrder");
    sortOrder = last ? last.sortOrder + 1 : 1;
  }
  return await ShowcaseSection.create({
    brandId: brand._id,
    title: payload.title,
    slug,
    description: payload.description?.trim(),
    sortOrder,
    sectionType: payload.sectionType || SHOWCASE_SECTION_TYPE.CUSTOM,
  });
};
