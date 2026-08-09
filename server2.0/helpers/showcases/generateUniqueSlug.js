const ShowcaseSection = require("../../models/ShowcaseSection");

exports.generateSlug = (title = "") => {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, "-");
};

exports.generateUniqueSlug = async (brandId, title) => {
  const baseSlug = exports.generateSlug(title);
  let slug = baseSlug;
  let count = 1;
  while (true) {
    const exists = await ShowcaseSection.exists({
      brandId,
      slug,
      isDeleted: false,
    });
    if (!exists) return slug;
    count++;
    slug = `${baseSlug}-${count}`;
  }
};
