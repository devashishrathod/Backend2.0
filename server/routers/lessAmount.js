const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const { verifyToken, checkRole } = require("../middleware");
const { create, getAll } = require("../controller/lessAmount");

router.post("/create", verifyToken, checkRole(ROLES.ADMIN), create);
router.get("/getAll", verifyToken, getAll);

module.exports = router;
