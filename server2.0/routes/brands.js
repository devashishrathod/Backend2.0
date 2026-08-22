const express = require("express");
const router = express.Router();
const {
  validateSchema,
  isVendor,
  isAdmin,
  verifyJwtToken,
} = require("../middlewares");
const { validateAddPanDetails } = require("../validator/pan");
const { validateAddGstDetails } = require("../validator/gst");
const { validateAddBankDetails } = require("../validator/bank");
const {
  validateAddBasicDetails,
  validateUpdateBasicDetails,
  validateGetBrand,
  validateUpdateBrand,
  validateReviewBrandVerification,
  validateGetAllBrandVerifications,
  validateGetBrandVerificationHistory,
} = require("../validator/brands");
const {
  addOrUpdateBasicDetails,
  addPanDetails,
  addGstDetails,
  addBankDetails,
  verifyBrand,
  acceptPartnershipDeed,
  get,
  update,
  reviewBrandVerification,
  acknowledgeApproval,
  getVerificationHistory,
  getAllVerifications,
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
// Vendor dismisses the approval congratulations screen → moves to DASHBOARD.
router.put("/onboarding/acknowledge-approval", isVendor, acknowledgeApproval);
// Onboarding (Review/Edit)
router.put(
  "/onboarding/update-basic-details",
  isVendor,
  validateSchema(validateUpdateBasicDetails),
  addOrUpdateBasicDetails,
);
// Admin — brand verification (approve / reject / revoke / reviewed-toggle)
router.get(
  "/admin/verifications",
  isAdmin,
  validateSchema(validateGetAllBrandVerifications),
  getAllVerifications,
);
router.put(
  "/admin/verifications/:brandId/review",
  isAdmin,
  validateSchema(validateReviewBrandVerification),
  reviewBrandVerification,
);
// Shared audit trail — admins see any brand, vendors only their own.
router.get(
  "/verifications/history",
  verifyJwtToken,
  validateSchema(validateGetBrandVerificationHistory),
  getVerificationHistory,
);

// General
router.get("/get", verifyJwtToken, validateSchema(validateGetBrand), get);
router.put(
  "/update",
  verifyJwtToken,
  validateSchema(validateUpdateBrand),
  update,
);

module.exports = router;
