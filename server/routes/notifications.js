const express = require("express");
const router = express.Router();

const {
  validateSchema,
  isAdmin,
  isVendorOrAdmin,
  isVendorOrAdminEvenIfDeactivated,
} = require("../middlewares");
const { getAll, markRead, broadcast } = require("../controllers/notifications");
const {
  validateGetAllNotifications,
  validateMarkNotificationsRead,
  validateBroadcastNotification,
} = require("../validator/notifications");

// A vendor is scoped to their own brand inside the service; an admin may pass
// any brandId, or omit it to read the admin-audience feed.

// Deliberately reachable by a deactivated account — read-only, and scoped to the
// caller's own brand. This is where the notice explaining the suspension lands,
// so refusing it would leave a vendor locked out with no in-app explanation.
// `mark-read` below is not exempt: it is a write, and a suspended account has no
// business writing.
router.get(
  "/get-all",
  isVendorOrAdminEvenIfDeactivated,
  validateSchema(validateGetAllNotifications),
  getAll,
);
router.put(
  "/mark-read",
  isVendorOrAdmin,
  validateSchema(validateMarkNotificationsRead),
  markRead,
);

// Admin only: this can reach every user on the platform.
router.post(
  "/broadcast",
  isAdmin,
  validateSchema(validateBroadcastNotification),
  broadcast,
);

module.exports = router;
