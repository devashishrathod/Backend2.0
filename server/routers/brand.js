const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const { verifyToken, checkRole } = require("../middleware/authValidation");
const { getAllBrand, pagination } = require("../controller/brand");
const {
  addBrand,
  updateBrand,
  activeOrInactiveBrand,
} = require("../controller/vendors");
const {
  followOrUnFollowBrand,
  getAllFollowBrands,
} = require("../controller/follows");

router.post("/addBrand", verifyToken, checkRole(ROLES.VENDOR), addBrand);
router.put(
  "/update/:id",
  verifyToken,
  checkRole(ROLES.ADMIN, ROLES.VENDOR),
  updateBrand,
);
router.put("/:brandId/toggle-follow", verifyToken, followOrUnFollowBrand);
router.put(
  "/:brandId/toggle-active",
  verifyToken,
  checkRole(ROLES.ADMIN, ROLES.VENDOR),
  activeOrInactiveBrand,
);
router.get("/me/followed-brands", verifyToken, getAllFollowBrands);
router.get("/getAll", getAllBrand);
router.get("/getOne/:id", verifyToken, getAllBrand);
router.get("/pagination", pagination);

module.exports = router;
