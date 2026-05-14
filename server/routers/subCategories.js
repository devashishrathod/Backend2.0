const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const { verifyToken, checkRole } = require("../middleware");
const {
  createSubCategory,
  getAllSubCategories,
  getSubCategory,
  updateSubCategory,
  deleteSubCategory,
} = require("../controller/subCategories");

router.post(
  "/:categoryId/create",
  verifyToken,
  checkRole(ROLES.ADMIN),
  createSubCategory
);
router.get("/getAll", getAllSubCategories);
router.get("/get/:id", getSubCategory);
router.put(
  "/update/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  updateSubCategory
);
router.delete(
  "/delete/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  deleteSubCategory
);

module.exports = router;
