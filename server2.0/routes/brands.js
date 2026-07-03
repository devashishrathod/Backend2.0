const express = require("express");
const router = express.Router();
const { validateSchema, isVendor, verifyJwtToken } = require("../middlewares");
const { validateAddPanDetails } = require("../validator/pan");
const { validateAddGstDetails } = require("../validator/gst");
const { validateAddBankDetails } = require("../validator/bank");
const {
  validateAddBasicDetails,
  validateUpdateBasicDetails,
  validateGetBrand,
} = require("../validator/brands");
const {
  addOrUpdateBasicDetails,
  addPanDetails,
  addGstDetails,
  addBankDetails,
  verifyBrand,
  acceptPartnershipDeed,
  get,
} = require("../controllers/brands");

// Onboarding Steps
router.post(
  "/onboarding/add-basic-details",
  isVendor,
  validateSchema(validateAddBasicDetails),
  addOrUpdateBasicDetails,
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
router.put("/onboarding/accept-partnership", isVendor, acceptPartnershipDeed);
// Onboarding (Review/Edit)
router.put(
  "/onboarding/update-basic-details",
  isVendor,
  validateSchema(validateUpdateBasicDetails),
  addOrUpdateBasicDetails,
);
// General
router.get("/get", verifyJwtToken, validateSchema(validateGetBrand), get);

module.exports = router;
