const express = require("express");
const router = express.Router();
const { validateSchema, isVendor } = require("../middlewares");
const {
  addBasicDetails,
  addPanDetails,
  addGstDetails,
  addBankDetails,
  verifyBrand,
} = require("../controllers/brands");
const { validateBasicDetails } = require("../validator/brands");
const { validateAddPanDetails } = require("../validator/pan");
const { validateAddGstDetails } = require("../validator/gst");
const { validateAddBankDetails } = require("../validator/bank");

router.post(
  "/onboarding/basic-details",
  isVendor,
  validateSchema(validateBasicDetails),
  addBasicDetails,
);
router.post(
  "/onboarding/add-pan-details",
  isVendor,
  validateSchema(validateAddPanDetails),
  addPanDetails,
);
router.post(
  "/onboarding/add-gst-details",
  isVendor,
  validateSchema(validateAddGstDetails),
  addGstDetails,
);
router.post(
  "/onboarding/add-bank-details",
  isVendor,
  validateSchema(validateAddBankDetails),
  addBankDetails,
);
router.get("/onboarding/system-verify", isVendor, verifyBrand);

module.exports = router;
