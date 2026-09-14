const { errorHandler } = require("./errorHandler");
const { cleanupTempFiles } = require("./cleanupTempFiles");
const { buildAuthGate } = require("./authenticate");
const {
  verifyJwtToken,
  verifyJwtTokenEvenIfDeactivated,
  optionalAuth,
} = require("./verifyJwtToken");
const { validateSchema } = require("./validateSchema");
const { requireShowcaseEnabled } = require("./requireShowcaseEnabled");
const {
  validateRoles,
  isAdmin,
  isVendor,
  isCustomer,
  isSubVendor,
  isVendorOrSubVendor,
  isBrandSideOrAdmin,
  isVendorOrAdmin,
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
  // Deletes what `express-fileupload` leaves behind on a successful upload.
  // Mount it **before** `fileUpload()` — see the note in the file.
  cleanupTempFiles,
  buildAuthGate,
  verifyJwtToken,
  verifyJwtTokenEvenIfDeactivated,
  optionalAuth,
  validateRoles,
  validateSchema,
  requireShowcaseEnabled,
  isAdmin,
  isVendor,
  isCustomer,
  isSubVendor,
  isVendorOrSubVendor,
  isBrandSideOrAdmin,
  isVendorOrAdmin,
};
