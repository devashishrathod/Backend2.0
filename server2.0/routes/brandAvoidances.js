const express = require("express");
const router = express.Router();

const { verifyJwtToken, validateSchema } = require("../middlewares");
const { toggle, getAll } = require("../controllers/brandAvoidances");
const {
  validateToggleBrandAvoidance,
  validateGetAllBrandAvoidances,
} = require("../validator/brandAvoidance");

router.use(verifyJwtToken);

router.post(
  "/toggle/:brandId",
  validateSchema(validateToggleBrandAvoidance),
  toggle,
);
router.get("/get-all", validateSchema(validateGetAllBrandAvoidances), getAll);

module.exports = router;
