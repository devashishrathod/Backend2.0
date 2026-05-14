const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const {
  addEmployee,
  deleteEmployee,
  toggleActiveDeactive,
  getAllEmployees,
} = require("../controller/employees");
const { verifyToken, checkRole } = require("../middleware");

router.post("/add", verifyToken, checkRole(ROLES.ADMIN), addEmployee);
router.delete(
  "/:id/delete",
  verifyToken,
  checkRole(ROLES.ADMIN),
  deleteEmployee
);
router.put(
  "/:id/toggle-status",
  verifyToken,
  checkRole(ROLES.ADMIN),
  toggleActiveDeactive
);
router.get("/get-all", verifyToken, checkRole(ROLES.ADMIN), getAllEmployees);

module.exports = router;
