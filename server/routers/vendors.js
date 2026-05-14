const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

// const {
//   registerVendor,
//   addCategorySubCategory,
//   addLocation,
//   addWorking,
// } = require("../controller/vendor");
const { getAllVendors } = require("../controller/vendors");
const { verifyToken, checkRole } = require("../middleware/authValidation");

// router.post("/register", registerVendor);
router.get(
  "/getAllVendors",
  verifyToken,
  checkRole(ROLES.ADMIN),
  getAllVendors
);
router.get(
  "/getAllVendors/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  getAllVendors
);
// router.put(
//   "/addCategorySubCategory/:id", //id of brand
//   verifyToken,
//   checkRole("vendor"),
//   addCategorySubCategory
// );
// router.put(
//   "/addLocation/:id", //id of brand
//   verifyToken,
//   checkRole(ROLES.VENDOR),
//   addLocation
// );
// router.put(
//   "/addWorkHours/:id", //id of brand
//   verifyToken,
//   checkRole(ROLES.VENDOR),
//   addWorking
// );

module.exports = router;
