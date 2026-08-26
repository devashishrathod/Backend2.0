const express = require("express");
const router = express.Router();

const {
  validateSchema,
  isAdmin,
  isVendorOrAdmin,
} = require("../middlewares");
const { getAll, markRead, broadcast } = require("../controllers/notifications");
const {
  validateGetAllNotifications,
  validateMarkNotificationsRead,
  validateBroadcastNotification,
} = require("../validator/notifications");

// A vendor is scoped to their own brand inside the service; an admin may pass
// any brandId, or omit it to read the admin-audience feed.

router.get(
  "/get-all",
  isVendorOrAdmin,
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
