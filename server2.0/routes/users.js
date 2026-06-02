const express = require("express");
const router = express.Router();

const { getUser, updateUser } = require("../controllers/users");
const { verifyJwtToken } = require("../middlewares");

router.get("/get", verifyJwtToken, getUser);
router.put("/update", verifyJwtToken, updateUser);

module.exports = router;
