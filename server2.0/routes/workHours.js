const express = require("express");
const router = express.Router();

const { validateSchema, isVendorOrAdmin } = require("../middlewares");
const { upsert } = require("../controllers/workHours");
const { validateUpsertWorkHours } = require("../validator/workHours");

// Weekly opening hours for a brand or one of its outlets. The target arrives as
// `brandId` / `subBrandId` in the body, so with only `verifyJwtToken` in front
// of it any signed-in caller could rewrite any outlet's hours.
router.post(
  "/upsert",
  isVendorOrAdmin,
  validateSchema(validateUpsertWorkHours),
  upsert,
);

module.exports = router;
