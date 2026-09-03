const express = require("express");
const router = express.Router();

const { getUser, updateUser } = require("../controllers/users");
const { verifyJwtToken } = require("../middlewares");

router.get("/get", verifyJwtToken, getUser);
router.put("/update", verifyJwtToken, updateUser);
router.delete("/delete", verifyJwtToken, (req, res) => {
  res.status(200).json({ message: "User deleted successfully" });
});

module.exports = router;
