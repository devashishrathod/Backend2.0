const express = require("express");
const router = express.Router();

const { validateSchema, isCustomer } = require("../middlewares");
const { toggle, getAll } = require("../controllers/follows");
const {
  validateToggleFollow,
  validateGetAllFollowedBrands,
} = require("../validator/follows");

// Following a brand is a customer action end to end — the services already
// resolve a Customer from the token and 404 otherwise. Saying so at the route
// turns that into a clean 403 instead of a confusing "Customer not found".
router.use(isCustomer);

router.post("/toggle/:brandId", validateSchema(validateToggleFollow), toggle);
router.get("/get-all", validateSchema(validateGetAllFollowedBrands), getAll);

module.exports = router;
