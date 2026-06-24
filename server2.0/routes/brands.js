const express = require("express");
const router = express.Router();
const { validateSchema, isVendor } = require("../middlewares");
const { validateAddPanDetails } = require("../validator/pan");
const { validateAddGstDetails } = require("../validator/gst");
const { validateAddBankDetails } = require("../validator/bank");
const {
  validateAddBasicDetails,
  validateUpdateBasicDetails,
} = require("../validator/brands");
const {
  addOrUpdateBasicDetails,
  addPanDetails,
  addGstDetails,
  addBankDetails,
  verifyBrand,
  acceptPartnershipDeed,
} = require("../controllers/brands");

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
router.put("/onboarding/approve-partnership", isVendor, acceptPartnershipDeed);
// Review/Edit
router.put(
  "/onboarding/update-basic-details",
  isVendor,
  validateSchema(validateUpdateBasicDetails),
  addOrUpdateBasicDetails,
);

module.exports = router;
