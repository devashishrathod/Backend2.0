// const express = require("express");
// const router = express.Router();
// const { ROLES } = require("../constants");

// const { verifyToken, checkRole } = require("../middleware/authValidation");
// const {
//   getAllSubCategory,
//   getSubCategoryPagination,
//   subCategoryByCategoryPagination,
//   subCategoryByCategory,
//   addSubCategory,
//   updateSubCategory,
//   deleteSubCategory,
//   updateStatus,
// } = require("../controller/subCategory");

// router.get("/getAll", getAllSubCategory);
// router.get("/getOne/:id", getAllSubCategory);
// router.get("/pagination", getSubCategoryPagination);
// router.get("/category/pagination/:id", subCategoryByCategoryPagination);
// router.get("/category/:id", subCategoryByCategory);
// router.post("/add", verifyToken, checkRole(ROLES.ADMIN), addSubCategory);
// router.put(
//   "/update/:id",
//   verifyToken,
//   checkRole(ROLES.ADMIN),
//   updateSubCategory
// );
// router.put(
//   "/update/status/:id",
//   verifyToken,
//   checkRole(ROLES.ADMIN),
//   updateStatus
// );
// router.delete(
//   "/delete/:id",
//   verifyToken,
//   checkRole(ROLES.ADMIN),
//   deleteSubCategory
// );

// module.exports = { router, routePrefix: "/subCategoriesss" };
