const express = require("express");
const router = express.Router();

const { validateSchema, isCustomer } = require("../middlewares");
const { toggle, getAll } = require("../controllers/brandAvoidances");
const {
  validateToggleBrandAvoidance,
  validateGetAllBrandAvoidances,
} = require("../validator/brandAvoidance");

// Customer-only, same as follows — the service resolves a Customer from the
// token, so the role gate just fails faster and more clearly.
router.use(isCustomer);

router.post(
  "/toggle/:brandId",
  validateSchema(validateToggleBrandAvoidance),
  toggle,
);
router.get("/get-all", validateSchema(validateGetAllBrandAvoidances), getAll);

module.exports = router;
