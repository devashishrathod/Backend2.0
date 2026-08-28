const ShowcaseSection = require("../../models/ShowcaseSection");

/** How many `-2`, `-3`, … suffixes to try before giving up on a base slug. */
const MAX_SLUG_ATTEMPTS = 50;

exports.generateSlug = (title = "") => {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, "-");
};

/**
 * A slug that is free within one brand.
 *
 * `excludeId` is the section being renamed. `updateSection` has always passed
 * it, but this helper only accepted two arguments and dropped it — so a section
 * matched its own slug, was told it was taken, and every rename walked the
 * title one suffix further (`ambience` → `ambience-2` → `ambience-3`) even when
 * the title had not really changed.
 *
 * @param {string|object} brandId
 * @param {string} title
 * @param {string|object} [excludeId] section id to ignore while checking
 */
exports.generateUniqueSlug = async (brandId, title, excludeId) => {
  const baseSlug = exports.generateSlug(title) || "section";

  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
    const filter = { brandId, slug, isDeleted: false };
    if (excludeId) filter._id = { $ne: excludeId };

    const exists = await ShowcaseSection.exists(filter);
    if (!exists) return slug;
  }

  // Unreachable in practice — a brand is capped at a handful of sections by its
  // plan. Falling back keeps the create path alive instead of looping forever.
  return `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`;
};
