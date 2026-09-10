const { ROLES } = require("../constants");
const { buildAuthGate } = require("./authenticate");

const validateRoles = (...allowedRoles) => buildAuthGate({ allowedRoles });

/**
 * ⚠️ There is deliberately no role gate that lets a deactivated account through.
 *
 * There was one — `validateRolesEvenIfDeactivated`, and an
 * `isVendorOrAdminEvenIfDeactivated` built from it — described as "notifications
 * only". No route ever mounted either, and the one route that genuinely has to
 * answer a suspended user (`routes/notifications.js`) reaches for
 * `verifyJwtTokenEvenIfDeactivated` instead, which is role-agnostic and is the
 * right shape for the job: a suspended user needs to *read the notice explaining
 * the suspension*, and that is not a per-role question.
 *
 * `buildAuthGate({ allowDeactivated: true })` still exists for exactly that one
 * caller. If a suspended-account route ever does need a role check, build it
 * here rather than reviving a gate nothing pointed at — and add it to
 * `postman/lib/routeGates.js` in the same commit, or the route documents itself
 * as PUBLIC.
 */

const isAdmin = validateRoles(ROLES.ADMIN);
const isCustomer = validateRoles(ROLES.CUSTOMER);
const isVendor = validateRoles(ROLES.VENDOR);
const isSubVendor = validateRoles(ROLES.SUB_VENDOR);

/**
 * Anyone who works for the brand — the owner or one of its outlets.
 *
 * The claim-side screens need this: a claim belongs to a brand, and both the
 * vendor and the outlet staff who served it have a legitimate reason to see it.
 * Without this pair every such route had to choose one and lock the other out.
 *
 * Scoping to a single outlet is a separate question, answered by `req.subBrandId`
 * inside the handler — a gate decides *whether*, not *how much*.
 */
const isVendorOrSubVendor = validateRoles(ROLES.VENDOR, ROLES.SUB_VENDOR);

/** ...and the same, with an admin able to look on their behalf. */
const isBrandSideOrAdmin = validateRoles(
  ROLES.VENDOR,
  ROLES.SUB_VENDOR,
  ROLES.ADMIN,
);

/**
 * Vendor tooling that an admin may also drive on a brand's behalf.
 *
 * Defined here rather than in each router: five route files were each
 * declaring their own `validateRoles(ROLES.VENDOR, ROLES.ADMIN)`, so the pair
 * could drift apart one file at a time. Ownership within the brand is still
 * the service's job — `helpers/brands/resolveActorBrand.js` — this gate only
 * keeps customers out of vendor tooling.
 */
const isVendorOrAdmin = validateRoles(ROLES.VENDOR, ROLES.ADMIN);

module.exports = {
  validateRoles,
  isAdmin,
  isCustomer,
  isVendor,
  isSubVendor,
  isVendorOrSubVendor,
  isBrandSideOrAdmin,
  isVendorOrAdmin,
};
