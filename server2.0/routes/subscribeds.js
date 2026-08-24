const express = require("express");
const router = express.Router();

const { validateSchema, validateRoles, isAdmin } = require("../middlewares");
const { ROLES } = require("../constants");
const {
  grant,
  cancel,
  get,
  getAll,
  history,
  resync,
  forfeited,
  compensateForfeit,
} = require("../controllers/subscribeds");
const {
  validateAdminGrantSubscription,
  validateAdminCancelSubscription,
  validateGetBrandSubscription,
  validateGetSubscribedHistory,
  validateGetAllSubscribeds,
  validateResyncBrandSubscription,
  validateGetForfeitedSubscriptions,
  validateCompensateForfeit,
} = require("../validator/subscribeds");

const isVendorOrAdmin = validateRoles(ROLES.VENDOR, ROLES.ADMIN);

// ---------------------------------------------------------------------------
// Admin — subscription management without an online payment.
// The paid path (with Razorpay) lives on /transactions/subscribe/*, which an
// admin may also drive on a vendor's behalf.
// ---------------------------------------------------------------------------

// Handles NEW, RENEW, UPGRADE and DOWNGRADE in one call — the response's
// `action` reports which one was applied.
router.post(
  "/admin/grant",
  isAdmin,
  validateSchema(validateAdminGrantSubscription),
  grant,
);
router.put(
  "/admin/cancel",
  isAdmin,
  validateSchema(validateAdminCancelSubscription),
  cancel,
);
router.get(
  "/admin/get-all",
  isAdmin,
  validateSchema(validateGetAllSubscribeds),
  getAll,
);
// Goodwill worklist: vendors who lost paid-for days by changing plan mid-term.
// No proration is applied at upgrade time, so this is how those terms are found
// and settled later.
router.get(
  "/admin/forfeited",
  isAdmin,
  validateSchema(validateGetForfeitedSubscriptions),
  forfeited,
);
router.put(
  "/admin/forfeited/compensate",
  isAdmin,
  validateSchema(validateCompensateForfeit),
  compensateForfeit,
);

// Repair endpoint: rebuild cached subscription state and plan limits.
router.put(
  "/admin/resync",
  isAdmin,
  validateSchema(validateResyncBrandSubscription),
  resync,
);

// ---------------------------------------------------------------------------
// Vendor + admin — a vendor is scoped to their own brand by resolveActorBrand.
// ---------------------------------------------------------------------------

router.get(
  "/get",
  isVendorOrAdmin,
  validateSchema(validateGetBrandSubscription),
  get,
);
router.get(
  "/history",
  isVendorOrAdmin,
  validateSchema(validateGetSubscribedHistory),
  history,
);

module.exports = router;
