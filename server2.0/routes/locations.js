const express = require("express");
const router = express.Router();

const { isAdmin, verifyJwtToken } = require("../middlewares");
const {
  create,
  getAll,
  get,
  //  update,
  deleteLocation,
} = require("../controllers/locations");

router.post("/create", verifyJwtToken, create);
router.get("/getAll", verifyJwtToken, getAll);
router.get("/get/:id", verifyJwtToken, get);
//router.put("/update/:id", isAdmin, update);
router.delete("/delete/:id", isAdmin, deleteLocation);

module.exports = router;
