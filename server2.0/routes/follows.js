const express = require("express");
const router = express.Router();

const { verifyJwtToken, validateSchema } = require("../middlewares");
const { toggle, getAll } = require("../controllers/follows");
const {
  validateToggleFollow,
  validateGetAllFollowedBrands,
} = require("../validator/follows");

router.use(verifyJwtToken);

router.post("/toggle/:brandId", validateSchema(validateToggleFollow), toggle);
router.get("/get-all", validateSchema(validateGetAllFollowedBrands), getAll);

module.exports = router;
