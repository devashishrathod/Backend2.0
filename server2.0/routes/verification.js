const express = require("express");
const router = express.Router();
const { validateSchema, isVendor } = require("../middlewares");
const {
  validateVerifyPan,
  validateVerifyGst,
  validateVerifyBank,
} = require("../validator/cgpeyAPIs");
const {
  verifyPan,
  verifyGst,
  verifyBank,
} = require("../controllers/cgpeyAPIs");

router.post(
  "/brands/onboarding/verify-pan",
  isVendor,
  validateSchema(validateVerifyPan),
  verifyPan,
);
router.post(
  "/brands/onboarding/verify-gst",
  isVendor,
  validateSchema(validateVerifyGst),
  verifyGst,
);
router.post(
  "/brands/onboarding/verify-bank",
  isVendor,
  validateSchema(validateVerifyBank),
  verifyBank,
);

module.exports = router;
