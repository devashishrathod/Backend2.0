const express = require("express");
const router = express.Router();
const { validateSchema, isVendor } = require("../middlewares");
const {
  updateBasicDetails,
} = require("../controllers/brands/updateBasicDetails");
const { validateBasicDetails } = require("../validator/brands");

router.put(
  "/onboarding/basic-details",
  isVendor,
  validateSchema(validateBasicDetails),
  updateBasicDetails,
);

module.exports = router;
