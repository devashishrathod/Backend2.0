// const express = require("express");
// const router = express.Router();
// const { ROLES } = require("../constants");

// const {
//   getAllCategory,
//   getCategoryPagination,
//   addCategory,
//   updateCategory,
//   deleteCategory,
//   updateStatus,
// } = require("../controller/category");
// const { verifyToken, checkRole } = require("../middleware/authValidation");

// router.get("/getAll", getAllCategory);
// router.get("/getOne/:id", getAllCategory);
// router.get("/pagination", getCategoryPagination);
// router.post("/add", verifyToken, checkRole(ROLES.ADMIN), addCategory);
// router.put("/update/:id", verifyToken, checkRole(ROLES.ADMIN), updateCategory);
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
//   deleteCategory
// );

// module.exports = { router, routePrefix: "/categoriesss" };
