const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const {
  getAllSubscription,
  pagination,
  updateSubscription,
  addSubscription,
  deleteSubscription,
} = require("../controller/subscription");

const { verifyToken, checkRole } = require("../middleware");

router.get("/getAll", getAllSubscription);
router.get("/getOne/:id", getAllSubscription);
router.get("/pagination", pagination);
router.post("/add", verifyToken, checkRole(ROLES.ADMIN), addSubscription);
router.put(
  "/update/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  updateSubscription
);
router.delete(
  "/delete/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  deleteSubscription
);

module.exports = router;
