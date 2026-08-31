const { ROLES } = require("../constants");
const { buildAuthGate } = require("./authenticate");

const validateRoles = (...allowedRoles) => buildAuthGate({ allowedRoles });

/**
 * Role gate that lets a deactivated account through.
 *
 * Only for endpoints a suspended user still has to reach — today that is reading
 * their notifications, which is where the notice explaining the suspension
 * lands. A killed session is still refused.
 */
const validateRolesEvenIfDeactivated = (...allowedRoles) =>
  buildAuthGate({ allowedRoles, allowDeactivated: true });

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

/** `isVendorOrAdmin`, reachable by a deactivated vendor. Notifications only. */
const isVendorOrAdminEvenIfDeactivated = validateRolesEvenIfDeactivated(
  ROLES.VENDOR,
  ROLES.ADMIN,
);

module.exports = {
  validateRoles,
  validateRolesEvenIfDeactivated,
  isAdmin,
  isCustomer,
  isVendor,
  isSubVendor,
  isVendorOrSubVendor,
  isBrandSideOrAdmin,
  isVendorOrAdmin,
  isVendorOrAdminEvenIfDeactivated,
};
