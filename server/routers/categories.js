const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const { verifyToken, checkRole } = require("../middleware");
const {
  createCategory,
  getAllCategories,
  getCategory,
  updateCategory,
  deleteCategory,
} = require("../controller/categories");

router.post("/create", verifyToken, checkRole(ROLES.ADMIN), createCategory);
router.get("/getAll", verifyToken, getAllCategories);
router.get("/get/:id", verifyToken, getCategory);
router.put("/update/:id", verifyToken, checkRole(ROLES.ADMIN), updateCategory);
router.delete(
  "/delete/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  deleteCategory
);

module.exports = router;
