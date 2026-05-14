const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const { verifyToken, checkRole } = require("../middleware");
const { createPromoCode, getAllPromoCode } = require("../controller/promoCode");

router.post("/create", verifyToken, checkRole(ROLES.ADMIN), createPromoCode);
router.get(
  "/getAll",
  verifyToken,
  checkRole(ROLES.USER, ROLES.ADMIN),
  getAllPromoCode
);

module.exports = router;
