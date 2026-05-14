const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const { verifyToken, checkRole } = require("../middleware");
const { create } = require("../controller/dailyPayments");

router.post("/clear-payment", verifyToken, checkRole(ROLES.ADMIN), create);

module.exports = router;
