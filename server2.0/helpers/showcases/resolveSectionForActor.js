const Brand = require("../../models/Brand");
const ShowcaseSection = require("../../models/ShowcaseSection");
const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");

/**
 * Load a showcase section and prove the caller is allowed to touch it.
 *
 * Every section and media service used to take a `userId`, ignore it, and act on
 * whatever `sectionId` arrived in the path — so one vendor could edit, reorder
 * or delete another vendor's gallery just by holding the id. This is the single
 * check they now share, so the rule cannot drift between the nine of them.
 *
 * Ownership is confirmed against `Brand.userId` rather than the token's cached
 * `brandId`, matching `resolveActorBrand` — a stale token cannot widen access.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 * @param {string} sectionId
 * @param {object} [options]
 * @param {object} [options.projection] passed straight to `findOne`
 * @returns {Promise<object>} the ShowcaseSection document
 */
exports.resolveSectionForActor = async (actor = {}, sectionId, options = {}) => {
  const query = ShowcaseSection.findOne(
    { _id: sectionId, isDeleted: false },
    options.projection,
  );

  const section = await query;
  if (!section) throwError(404, "Showcase section not found.");

  // Admins moderate every brand's content.
  if (actor.role === ROLES.ADMIN) return section;

  if (actor.role !== ROLES.VENDOR) throwError(403, "Forbidden");

  const brand = await Brand.findOne({
    _id: section.brandId,
    isDeleted: false,
  })
    .select("userId")
    .lean();

  if (!brand || String(brand.userId) !== String(actor.userId)) {
    throwError(
      403,
      "Forbidden: You do not have permission to perform this action on this showcase.",
    );
  }

  return section;
};
