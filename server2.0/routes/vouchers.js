const express = require("express");
const router = express.Router();

const { verifyJwtToken, validateSchema } = require("../middlewares");
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
} = require("../validator/vouchers");

router.use(verifyJwtToken);

router.post("/create", validateSchema(validateCreateVoucher), create);
// router.put("/update/:voucherId", validateSchema(validateUpdateVoucher), update);
router.post(
  "/submit-review/:voucherId",
  validateSchema(validateSubmitVoucherForReview),
  submitForReview,
);
router.post(
  "/review/:versionId",
  validateSchema(validateReviewVoucher),
  review,
);
router.post(
  "/publish/:versionId",
  validateSchema(validatePublishVoucher),
  publish,
);
router.get(
  "/versions/get-all",
  validateSchema(validateGetAllVoucherVersions),
  getAllVersions,
);

// Customer
router.get(
  "/customer/get-all",
  validateSchema(validateCustomerGetAllVouchers),
  getAllCustomerVouchers,
);
router.get(
  "/customer/get/:voucherId",
  validateSchema(validateCustomerGetVoucher),
  getCustomerVoucher,
);
router.post(
  "/customer/voucher/preview",
  validateSchema(validateCustomerVoucherPreview),
  previewCustomerVoucher,
);

module.exports = router;
