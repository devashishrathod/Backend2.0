const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const { verifyToken, checkRole } = require("../middleware/authValidation");

const {
  createImageForBrandOrSubBrand,
  getImagesForBrandOrSubBrand,
  updateImagesForBrandOrSubBrand,
} = require("../controller/images");

router.post(
  "/addImage",
  verifyToken,
  checkRole(ROLES.ADMIN, ROLES.VENDOR, ROLES.SUB_VENDOR),
  createImageForBrandOrSubBrand
);

router.get("/getAllImages/:entityId", verifyToken, getImagesForBrandOrSubBrand);

router.put(
  "/updateOrDeleteImages/:entityId",
  verifyToken,
  checkRole(ROLES.ADMIN, ROLES.VENDOR, ROLES.SUB_VENDOR),
  updateImagesForBrandOrSubBrand
);

module.exports = router;
