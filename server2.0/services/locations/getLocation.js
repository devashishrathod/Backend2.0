const Location = require("../../models/Location");
const SubBrand = require("../../models/SubBrand");
const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");

/**
 * Fetch one location, scoped to what the caller is entitled to see.
 *
 * The id alone used to be enough: any authenticated user could read any
 * location document, which meant every customer's home address and coordinates
 * were one guessable-but-leaked ObjectId away. A role gate alone does not fix
 * that — a customer *should* be able to read their own address, just not
 * somebody else's — so ownership is resolved per role here.
 *
 * @param {{ id: string }} payload
 * @param {{ userId: string, role: string, brandId?: string }} actor
 */
exports.getLocation = async (payload, actor = {}) => {
  const { id } = payload;

  const result = await Location.findById(id);
  if (!result || result.isDeleted) throwError(404, "Location not found");

  // Admins moderate every brand and outlet, so they see everything.
  if (actor.role === ROLES.ADMIN) return result;

  if (actor.role === ROLES.CUSTOMER) {
    if (String(result.userId) !== String(actor.userId)) {
      throwError(403, "Forbidden");
    }
    return result;
  }

  if (actor.role === ROLES.VENDOR) {
    if (!actor.brandId) throwError(403, "Forbidden");

    // The brand's own registered address.
    if (String(result.brandId) === String(actor.brandId)) return result;

    // Or one of its outlets'. Checked against the SubBrand rather than the
    // token so a stale `brandId` claim cannot widen the answer.
    if (result.subBrandId) {
      const ownsOutlet = await SubBrand.exists({
        _id: result.subBrandId,
        brandId: actor.brandId,
        isDeleted: false,
      });
      if (ownsOutlet) return result;
    }

    throwError(403, "Forbidden");
  }

  throwError(403, "Forbidden");
};
