const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const { verifyToken, checkRole } = require("../middleware");
const { createBill, verifyBill } = require("../controller/bills");

router.post("/create", verifyToken, checkRole(ROLES.USER), createBill);
router.put("/verify", verifyToken, checkRole(ROLES.USER), verifyBill);

module.exports = router;
