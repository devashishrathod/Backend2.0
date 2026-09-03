const express = require("express");
const router = express.Router();
const {
  validateSchema,
  isVendor,
  isAdmin,
  isCustomer,
  isVendorOrAdmin,
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
  validateGetCustomerBrand,
  validateGetAllCustomerBrands,
  validateReviewTopBrand,
  validateGetTopBrands,
  validateGetAllAdminBrands,
  validateToggleBrandStatus,
} = require("../validator/brands");
const {
  addOrUpdateBasicDetails,
  addPanDetails,
  addGstDetails,
  addBankDetails,
  verifyBrand,
  acceptPartnershipDeed,
  get,
  getCustomer,
  getAllCustomer,
  getAllAdmin,
  toggleStatus,
  update,
  reviewBrandVerification,
  reviewTopBrand,
  getTopBrands,
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
// ---------------------------------------------------------------------------
// Admin — the brand directory, and the account on/off switch.
//
// `/admin/get-all` is the triage list: identity, owner, verification state,
// plan, usage and the deactivation trail, one row per brand. Its own pipeline
// rather than a role branch on the customer listing — see the note on
// `/customer/get-all` below for why role-filtered projections are avoided here.
//
// The toggle is the only endpoint that switches a brand account off. It moves
// `Brand.isActive` and the owning vendor's `User.isActive` together, so the
// brand leaves every customer listing and the vendor is refused by the auth gate
// on their very next request — not merely at their next login.
//
// Declared before `/admin/:brandId/status` so the literal `get-all` is never
// read as a brand id.
// ---------------------------------------------------------------------------
router.get(
  "/admin/get-all",
  isAdmin,
  validateSchema(validateGetAllAdminBrands),
  getAllAdmin,
);
router.put(
  "/admin/:brandId/status",
  isAdmin,
  validateSchema(validateToggleBrandStatus),
  toggleStatus,
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
// Admin — "Top Brands" curation. One endpoint both ways: `isTopBrand: false`
// removes, and a new `topOrder` on an already-pinned brand reorders it.
router.put(
  "/admin/top-brands/:brandId",
  isAdmin,
  validateSchema(validateReviewTopBrand),
  reviewTopBrand,
);
// The admin's own view of that list — unlike the customer tab it also shows
// brands that have since been deactivated, so they can be unpinned.
router.get(
  "/admin/top-brands",
  isAdmin,
  validateSchema(validateGetTopBrands),
  getTopBrands,
);
// Shared audit trail — admins see any brand, vendors only their own.
router.get(
  "/verifications/history",
  isVendorOrAdmin,
  validateSchema(validateGetBrandVerificationHistory),
  getVerificationHistory,
);

// ---------------------------------------------------------------------------
// Customer — the public brand profile.
//
// Its own endpoint rather than a role-filtered `/get`: that pipeline joins the
// brand's PAN, GSTIN, bank account, KYC scores and subscription billing, and a
// projection that strips six sensitive joins is one edit away from leaking
// again. This one only ever builds what the profile screen renders — brand,
// features, visible showcase and outlets — so there is nothing to strip.
// ---------------------------------------------------------------------------
// The brand directory and the "Top Brands" tab, both from here — `topOnly`
// narrows to the curated picks, and without it the picks simply lead the list.
// Declared before `/customer/get/:brandId` so the literal path is never read as
// a brand id.
router.get(
  "/customer/get-all",
  validateSchema(validateGetAllCustomerBrands),
  getAllCustomer,
);
router.get(
  "/customer/get/:brandId",
  validateSchema(validateGetCustomerBrand),
  getCustomer,
);

// General — vendor's own brand, or any brand for an admin. Not customer-facing:
// see the note above.
router.get("/get", isVendorOrAdmin, validateSchema(validateGetBrand), get);
router.put(
  "/update",
  isVendorOrAdmin,
  validateSchema(validateUpdateBrand),
  update,
);

module.exports = router;
