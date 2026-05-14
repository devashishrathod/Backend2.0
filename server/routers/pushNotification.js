const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const { verifyToken, checkRole } = require("../middleware");
const { createPushNotification } = require("../controller/pushNotifications");

router.post(
  "/:voucherId/create",
  verifyToken,
  checkRole(ROLES.ADMIN),
  createPushNotification
);

module.exports = router;
