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
 * **Callers must use the returned document.** Each service used to re-read the
 * same section straight after this call, paying for two identical queries on
 * every write; `projection` is here so one read serves both purposes.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 * @param {string} sectionId
 * @param {object} [options]
 * @param {object} [options.projection]    passed straight to `findOne`
 * @param {boolean} [options.lean]         return a plain object, for read paths
 * @param {boolean} [options.requireActive] 404 unless the section is active
 * @returns {Promise<object>} the ShowcaseSection document
 */
exports.resolveSectionForActor = async (actor = {}, sectionId, options = {}) => {
  const filter = { _id: sectionId, isDeleted: false };
  if (options.requireActive) filter.isActive = true;

  /**
   * `brandId` is what ownership is decided on, so it is always read back even
   * when a caller's projection forgot to ask for it.
   *
   * 🔴 `__v` for a sharper reason. An inclusion projection returns **only** the
   * named fields, so a document loaded without the version key has no version to
   * check — and Mongoose then saves it with no version predicate at all, even
   * with `optimisticConcurrency` on. The lock would not fail loudly; it would
   * **silently not be a lock**, on exactly the read-modify-write paths it exists
   * to protect, and every service in this domain projects.
   *
   * Measured both ways in `__tests__/money/showcaseVersionLock.test.js`: the same
   * two concurrent deletes damage the order when loaded through a projection
   * without `__v`, and raise a `VersionError` when loaded through this function.
   *
   * A guarantee that quietly does nothing is worse than no guarantee, because
   * everyone downstream believes it.
   */
  const projection = options.projection
    ? { ...options.projection, brandId: 1, __v: 1 }
    : undefined;

  const query = ShowcaseSection.findOne(filter, projection);
  if (options.lean) query.lean();

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
