const express = require("express");
const router = express.Router();

const { verifyJwtToken, validateSchema } = require("../middlewares");
const {
  create,
  update,
  submitForReview,
  review,
  publish,
} = require("../controllers/vouchers");
const {
  validateCreateVoucher,
  validateUpdateVoucher,
  validateSubmitVoucherForReview,
  validateReviewVoucher,
  validatePublishVoucher,
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

module.exports = router;
