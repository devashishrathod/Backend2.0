const express = require("express");
const router = express.Router();

const {
  verifyJwtToken,
  validateSchema,
  validateRoles,
  isAdmin,
} = require("../middlewares");
const { ROLES } = require("../constants");
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
} = require("../validator/vouchers");

// Every voucher write consumes a slot from the owning brand's plan, so these
// are gated to the brand owner (or an admin). Ownership itself is enforced
// per-brand inside the services via resolveActorBrand; the route gate only keeps
// customers out of vendor tooling.
const isVendorOrAdmin = validateRoles(ROLES.VENDOR, ROLES.ADMIN);

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
  verifyJwtToken,
  validateSchema(validateGetAllVoucherVersions),
  getAllVersions,
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
