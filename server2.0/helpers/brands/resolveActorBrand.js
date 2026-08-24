const Brand = require("../../models/Brand");
const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");

/**
 * Resolve which brand an actor is allowed to operate on, and load it.
 *
 * This closes the hole the subscription routes previously had: they only ran
 * `verifyJwtToken`, took `brandId` straight from the body, and never checked
 * ownership — so any authenticated user could open an order against any brand.
 *
 * - ADMIN  must name a brandId, and may name any brand.
 * - VENDOR falls back to their own brand, and may only name their own.
 *
 * @param {{ userId, role, brandId }} actor  built by the controller from `req`
 * @param {string} [requestedBrandId]        brandId from the validated payload
 * @returns {Promise<object>} the Brand document
 */
exports.resolveActorBrand = async (actor = {}, requestedBrandId) => {
  const { userId, role, brandId: actorBrandId } = actor;

  if (role === ROLES.ADMIN) {
    if (!requestedBrandId) {
      throwError(422, "brandId is required when acting as an admin");
    }
    const brand = await Brand.findById(requestedBrandId);
    if (!brand || brand.isDeleted) throwError(404, "Brand not found!");
    return brand;
  }

  const targetId = requestedBrandId || actorBrandId;
  if (!targetId) {
    throwError(404, "No brand is linked to your account");
  }

  const brand = await Brand.findById(targetId);
  if (!brand || brand.isDeleted) throwError(404, "Brand not found!");

  // Trust the brand's own userId rather than the token's cached brandId.
  if (String(brand.userId) !== String(userId)) {
    throwError(
      403,
      "Forbidden: You do not have permission to perform this action on this brand.",
    );
  }
  return brand;
};
