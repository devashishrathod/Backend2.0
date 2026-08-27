const { errorHandler } = require("./errorHandler");
const { buildAuthGate } = require("./authenticate");
const {
  verifyJwtToken,
  verifyJwtTokenEvenIfDeactivated,
} = require("./verifyJwtToken");
const { validateSchema } = require("./validateSchema");
const {
  validateRoles,
  validateRolesEvenIfDeactivated,
  isAdmin,
  isVendor,
  isCustomer,
  isSubVendor,
  isVendorOrAdmin,
  isVendorOrAdminEvenIfDeactivated,
} = require("./validateRoles");

// ---------------------------------------------------------------------------
// `…EvenIfDeactivated` gates
//
// A deactivated account is refused by every other gate with a 401, which is
// what makes the client sign it out. These three endpoints are the deliberate
// exceptions, because refusing them would leave a suspended user stuck:
//
//   POST /auth/logout              — clean exit
//   PUT  /deviceTokens/unregister  — stop the push notifications
//   GET  /notifications/get-all    — read the notice explaining the suspension
//
// They relax the `isActive` check only. A session killed through
// `User.sessionInvalidatedAt` is refused here as well.
// ---------------------------------------------------------------------------

module.exports = {
  errorHandler,
  buildAuthGate,
  verifyJwtToken,
  verifyJwtTokenEvenIfDeactivated,
  validateRoles,
  validateRolesEvenIfDeactivated,
  validateSchema,
  isAdmin,
  isVendor,
  isCustomer,
  isSubVendor,
  isVendorOrAdmin,
  isVendorOrAdminEvenIfDeactivated,
};
