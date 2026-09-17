const express = require("express");
const router = express.Router();

const {
  validateSchema,
  isAdmin,
  isVendorOrAdmin,
  optionalAuth,
} = require("../middlewares");
const {
  create,
  update,
  submitForReview,
  review,
  publish,
  pause,
  resume,
  getAllVersions,
  getAllCustomerVouchers,
  getCustomerVoucher,
  previewCustomerVoucher,
  setBanner,
  reviewBanner,
  reviewSuggestion,
  getSuggestions,
} = require("../controllers/vouchers");
const {
  validateCreateVoucher,
  validateUpdateVoucher,
  validateSubmitVoucherForReview,
  validateReviewVoucher,
  validatePublishVoucher,
  validatePauseVoucher,
  validateResumeVoucher,
  validateGetAllVoucherVersions,
  validateCustomerGetAllVouchers,
  validateCustomerGetVoucher,
  validateCustomerVoucherPreview,
  validateSetVoucherBanner,
  validateReviewVoucherBanner,
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
/**
 * Pause / resume — the vendor's own switch on a live voucher (V-5).
 *
 * ⚠️ `isVendorOrAdmin`, same as publish, and ownership is checked again inside
 * the service. Taking a voucher off the customer app is the same size of action
 * as putting one on it, so it gets the same gate — the route only establishes
 * that the caller is *a* vendor.
 */
router.post(
  "/pause/:versionId",
  isVendorOrAdmin,
  validateSchema(validatePauseVoucher),
  pause,
);
router.post(
  "/resume/:versionId",
  isVendorOrAdmin,
  validateSchema(validateResumeVoucher),
  resume,
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

// Voucher banner (master-level, independent of the version/approval flow —
// though it has a review of its own).
router.post(
  "/:voucherId/banner",
  isVendorOrAdmin,
  validateSchema(validateSetVoucherBanner),
  setBanner,
);
/**
 * 🔴 Admin-only, and that is the point of the whole slot: a vendor uploads into
 * `pending`, an admin decides whether it reaches customers.
 *
 * Declared after the POST above so `/:voucherId/banner` cannot swallow it —
 * `banner/review` is a longer path, but Express matches in declaration order.
 */
router.post(
  "/:voucherId/banner/review",
  isAdmin,
  validateSchema(validateReviewVoucherBanner),
  reviewBanner,
);

// ---------------------------------------------------------------------------
// Customer — open to guests, personalised when signed in.
//
// `optionalAuth` rather than no gate at all: these handlers read `req.userId`
// to fall back to the customer's saved location, and with no gate that is
// `undefined` even for a signed-in caller — which made every one of these
// answer `404 "Customer not found."` for everybody.
//
// A guest simply has to pass `latitude` + `longitude` explicitly.
// ---------------------------------------------------------------------------
router.get(
  "/customer/get-all",
  optionalAuth,
  validateSchema(validateCustomerGetAllVouchers),
  getAllCustomerVouchers,
);
router.get(
  "/customer/get/:voucherId",
  optionalAuth,
  validateSchema(validateCustomerGetVoucher),
  getCustomerVoucher,
);
router.post(
  "/customer/voucher/preview",
  optionalAuth,
  validateSchema(validateCustomerVoucherPreview),
  previewCustomerVoucher,
);

module.exports = router;
