const express = require("express");
const router = express.Router();

const {
  verifyJwtToken,
  validateSchema,
  isAdmin,
  isVendorOrAdmin,
} = require("../middlewares");
const {
  create,
  update,
  submitForReview,
  review,
  publish,
  getAllVersions,
  getAllCustomerVouchers,
  getCustomerVoucher,
  previewCustomerVoucher,
  setBanner,
  deleteBanner,
  reviewSuggestion,
  getSuggestions,
} = require("../controllers/vouchers");
const {
  validateCreateVoucher,
  validateUpdateVoucher,
  validateSubmitVoucherForReview,
  validateReviewVoucher,
  validatePublishVoucher,
  validateGetAllVoucherVersions,
  validateCustomerGetAllVouchers,
  validateCustomerGetVoucher,
  validateCustomerVoucherPreview,
  validateSetVoucherBanner,
  validateDeleteVoucherBanner,
  validateReviewVoucherSuggestion,
  validateGetSuggestedVouchers,
} = require("../validator/vouchers");

// Every voucher write consumes a slot from the owning brand's plan, so these
// are gated to the brand owner (or an admin). Ownership itself is enforced
// per-brand inside the services via resolveActorBrand; the route gate only keeps
// customers out of vendor tooling.

router.post(
  "/create",
  isVendorOrAdmin,
  validateSchema(validateCreateVoucher),
  create,
);
router.put(
  "/update/:voucherId",
  isVendorOrAdmin,
  validateSchema(validateUpdateVoucher),
  update,
);
router.post(
  "/submit-review/:voucherId",
  isVendorOrAdmin,
  validateSchema(validateSubmitVoucherForReview),
  submitForReview,
);
// Approval decisions are the admin's, not the vendor's.
router.post(
  "/review/:versionId",
  isAdmin,
  validateSchema(validateReviewVoucher),
  review,
);
router.post(
  "/publish/:versionId",
  isVendorOrAdmin,
  validateSchema(validatePublishVoucher),
  publish,
);
router.get(
  "/versions/get-all",
  isVendorOrAdmin,
  validateSchema(validateGetAllVoucherVersions),
  getAllVersions,
);

// Admin — "Suggestions" curation. One endpoint both ways: `isSuggested: false`
// removes, and a new `suggestionOrder` on an already-pinned voucher reorders it.
// Declared before `/:voucherId/banner` so `admin` is never read as a voucher id.
router.put(
  "/admin/suggestions/:voucherId",
  isAdmin,
  validateSchema(validateReviewVoucherSuggestion),
  reviewSuggestion,
);
// The admin's own view of that list — unlike the customer tab it also shows
// vouchers that have since expired or been unpublished, so they can be unpinned.
router.get(
  "/admin/suggestions",
  isAdmin,
  validateSchema(validateGetSuggestedVouchers),
  getSuggestions,
);

// Voucher banner (master-level, independent of version/approval flow)
router.post(
  "/:voucherId/banner",
  isVendorOrAdmin,
  validateSchema(validateSetVoucherBanner),
  setBanner,
);
router.delete(
  "/:voucherId/banner",
  isVendorOrAdmin,
  validateSchema(validateDeleteVoucherBanner),
  deleteBanner,
);

// Customer
router.get(
  "/customer/get-all",
  verifyJwtToken,
  validateSchema(validateCustomerGetAllVouchers),
  getAllCustomerVouchers,
);
router.get(
  "/customer/get/:voucherId",
  verifyJwtToken,
  validateSchema(validateCustomerGetVoucher),
  getCustomerVoucher,
);
router.post(
  "/customer/voucher/preview",
  verifyJwtToken,
  validateSchema(validateCustomerVoucherPreview),
  previewCustomerVoucher,
);

module.exports = router;
