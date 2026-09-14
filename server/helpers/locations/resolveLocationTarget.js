const SubBrand = require("../../models/SubBrand");
const User = require("../../models/User");
const { ROLES } = require("../../constants");
const { LOCATION_KINDS } = require("../../constants/location");
const { resolveActorBrand } = require("../brands");
const { throwError } = require("../../utils");

/**
 * Who a Location belongs to, and whether this caller may write it.
 *
 * Every write — create, update, delete, and the customer's upsert — goes
 * through here, so there is one answer to "may you?" and one answer to "whose
 * is it?" rather than a different pair in each service.
 *
 * ### Why this exists
 *
 * `updateLocation` took a `userId` and never used it; `deleteLocation` did not
 * take one at all; `getAllLocations` had no actor. All three found the row by
 * id and acted on it. Since a Location can belong to a **customer**, that meant
 * any vendor token could edit or delete a customer's home address, and the
 * voucher feed is built from that address — so rewriting it silently changes
 * what somebody else is shown.
 *
 * ### Ownership is derived, never accepted
 *
 * The caller says *which* brand, outlet or customer. What gets written onto the
 * row — `userId`, `customerId`, `brandId`, `subBrandId` — is read off that
 * entity here. A client cannot hand us a `userId` and have it stored.
 *
 * `userId` answers "whose address is this", not "who typed it". An admin
 * fixing a customer's address leaves `userId` pointing at the customer and
 * records themselves in `updatedBy`; without that separation the customer
 * could no longer find their own address.
 */

/**
 * The two legacy booleans, as a projection of `kind`.
 *
 * The model derives these itself in a `pre("validate")` hook, so a document
 * cannot be saved with them wrong. Services still set them explicitly because
 * `findOneAndUpdate` does not run that hook, and because a write that spells
 * out what it stores is easier to read than one that relies on a hook three
 * files away.
 */
exports.flagsForKind = (kind) => ({
  isBrandAddress: kind === LOCATION_KINDS.BRAND,
  isSubBrandAddress: kind === LOCATION_KINDS.SUB_BRAND,
});

/** An outlet's address carries its brand too, so `subBrandId` is checked first. */
exports.kindOfLocation = (location) => {
  if (!location) return null;
  if (location.kind) return location.kind;

  // Rows written before `kind` existed. Not a fallback that will linger: the
  // backfill sets `kind` on every row and the field becomes required after it.
  if (location.subBrandId) return LOCATION_KINDS.SUB_BRAND;
  if (location.brandId) return LOCATION_KINDS.BRAND;
  if (location.customerId || location.userId) return LOCATION_KINDS.CUSTOMER;
  return null;
};

/**
 * What the caller asked for, as a kind.
 *
 * Accepts the two booleans because that is what the API has always taken and
 * what the panels send. They are read here and never stored — `kind` is.
 */
exports.deriveKind = ({ kind, isBrandAddress, isSubBrandAddress } = {}) => {
  if (kind) {
    if (!LOCATION_KINDS[kind]) throwError(400, `Unknown location type: ${kind}`);
    return kind;
  }

  const brand = isBrandAddress === true || isBrandAddress === "true";
  const outlet = isSubBrandAddress === true || isSubBrandAddress === "true";

  if (brand && outlet) {
    throwError(
      400,
      "Location cannot be both Brand address and SubBrand address",
    );
  }
  if (brand) return LOCATION_KINDS.BRAND;
  if (outlet) return LOCATION_KINDS.SUB_BRAND;
  return LOCATION_KINDS.CUSTOMER;
};

/**
 * @param {{ userId: string, role: string, brandId?: string }} actor
 * @param {{ kind?, brandId?, subBrandId?, userId?, isBrandAddress?, isSubBrandAddress? }} input
 * @returns {Promise<{ kind: string, ownership: object, entity: object }>}
 */
exports.resolveLocationTarget = async (actor = {}, input = {}) => {
  const kind = exports.deriveKind(input);

  if (kind === LOCATION_KINDS.BRAND) {
    if (actor.role === ROLES.CUSTOMER) {
      throwError(403, "Forbidden: You do not have permission to perform this action.");
    }
    /**
     * Handles both roles on its own: an admin must name a brand and may name
     * any, a vendor falls back to their own and may only name their own — and
     * it verifies against `Brand.userId` rather than the token's cached
     * `brandId`, so an old token cannot widen what it reaches.
     */
    const brand = await resolveActorBrand(actor, input.brandId);
    return {
      kind,
      entity: brand,
      ownership: {
        userId: brand.userId,
        customerId: undefined,
        brandId: brand._id,
        subBrandId: undefined,
      },
    };
  }

  if (kind === LOCATION_KINDS.SUB_BRAND) {
    if (actor.role === ROLES.CUSTOMER) {
      throwError(403, "Forbidden: You do not have permission to perform this action.");
    }
    if (!input.subBrandId) {
      throwError(400, "subBrandId is required for SubBrand address");
    }

    const subBrand = await SubBrand.findOne({
      _id: input.subBrandId,
      isDeleted: false,
    });
    if (!subBrand) throwError(404, "SubBrand not found");

    /**
     * An outlet manager may keep **their own** outlet's address, and nothing
     * else.
     *
     * ⚠️ Checked against the token's `subBrandId` rather than through
     * `resolveActorBrand`, because a sub-vendor has no brand of their own to
     * resolve: `authenticate` copies the brand off their outlet, so asking
     * "does this brand belong to you" would compare a borrowed id against
     * `Brand.userId` and always refuse. The outlet id is the thing that is
     * actually theirs.
     */
    if (actor.role === ROLES.SUB_VENDOR) {
      if (String(actor.subBrandId ?? "") !== String(subBrand._id)) {
        throwError(
          403,
          "Forbidden: You do not have permission to perform this action on this outlet.",
        );
      }
      return {
        kind,
        entity: subBrand,
        ownership: {
          userId: subBrand.userId,
          customerId: undefined,
          brandId: subBrand.brandId,
          subBrandId: subBrand._id,
        },
      };
    }

    /**
     * The outlet's own brand is the thing being checked, not whatever brand the
     * caller sent — an outlet id is enough to find out which brand it is under,
     * so there is nothing for the client to get wrong or to lie about.
     */
    await resolveActorBrand(actor, subBrand.brandId);

    return {
      kind,
      entity: subBrand,
      ownership: {
        userId: subBrand.userId,
        customerId: undefined,
        // ⚠️ The brand goes on the outlet's address too. "Every address under
        // this brand" is then one indexed query instead of a `$in` over every
        // outlet id, which is also what scopes a vendor's list to their own.
        brandId: subBrand.brandId,
        subBrandId: subBrand._id,
      },
    };
  }

  // CUSTOMER
  if (actor.role === ROLES.VENDOR || actor.role === ROLES.SUB_VENDOR) {
    throwError(403, "Forbidden: You do not have permission to perform this action.");
  }

  let targetUserId;
  if (actor.role === ROLES.ADMIN) {
    if (!input.userId) {
      throwError(422, "userId is required when an admin acts on a customer address");
    }
    targetUserId = input.userId;
  } else if (actor.role === ROLES.CUSTOMER) {
    // A customer's own token, always. A `userId` in the body is ignored rather
    // than refused — it used to be preferred over the token, which let any
    // customer overwrite any other customer's address by naming their id.
    targetUserId = actor.userId;
  } else {
    throwError(403, "Forbidden: You do not have permission to perform this action.");
  }

  const user = await User.findById(targetUserId).select("_id role customerId isDeleted");
  if (!user || user.isDeleted) throwError(404, "User not found");
  if (user.role !== ROLES.CUSTOMER) throwError(400, "User is not a customer");
  if (!user.customerId) throwError(404, "Customer not found");

  return {
    kind,
    entity: user,
    ownership: {
      userId: user._id,
      customerId: user.customerId,
      brandId: undefined,
      subBrandId: undefined,
    },
  };
};

/** The id that decides whose a row is, per kind. */
const OWNER_KEY = {
  [LOCATION_KINDS.BRAND]: "brandId",
  [LOCATION_KINDS.SUB_BRAND]: "subBrandId",
  [LOCATION_KINDS.CUSTOMER]: "userId",
};

/**
 * The same check, for a row that already exists.
 *
 * Update and delete do not take a kind — the row carries it, along with the ids
 * that say whose it is. Those are handed back to `resolveLocationTarget` so an
 * existing row is authorised by exactly the rule that created it.
 */
exports.resolveExistingLocationTarget = async (actor, location) => {
  const kind = exports.kindOfLocation(location);
  if (!kind) throwError(400, "This location has no owner and cannot be modified.");

  const target = await exports.resolveLocationTarget(actor, {
    kind,
    brandId: location.brandId,
    subBrandId: location.subBrandId,
    userId: location.userId,
  });

  /**
   * ⚠️ Load-bearing, and not obviously so.
   *
   * `resolveLocationTarget` answers "which owner may this caller act for" — not
   * "is this row that owner's". For a customer it deliberately ignores the
   * `userId` it is handed and resolves to the caller's own account, because on
   * create that is the only account they may write. Handing it an existing row
   * therefore comes back **successful** whoever the row belongs to, and without
   * the comparison below any customer could edit any other customer's address
   * by id — the exact hole this helper was written to close.
   *
   * For a brand or an outlet the row's own id is what went in, so the check
   * already happened inside `resolveActorBrand`; this just makes that true by
   * construction rather than by reading two functions together.
   */
  const key = OWNER_KEY[kind];
  if (String(target.ownership[key] ?? "") !== String(location[key] ?? "")) {
    throwError(
      403,
      "Forbidden: You do not have permission to perform this action.",
    );
  }

  return target;
};
