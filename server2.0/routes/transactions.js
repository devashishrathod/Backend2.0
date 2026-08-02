const express = require("express");
const router = express.Router();
const { validateSchema, isVendor, verifyJwtToken } = require("../middlewares");

const {
  validateCreateSubscribeOrder,
  validateVerifySubscribeTransaction,
} = require("../validator/transactions");
const {
  subscribeCreateOrder,
  subscribeVerifyTransaction,
} = require("../controllers/transactions");

router.post(
  "/subscribe/create-order",
  verifyJwtToken,
  validateSchema(validateCreateSubscribeOrder),
  subscribeCreateOrder,
);
router.post(
  "/subscribe/verify-transaction",
  verifyJwtToken,
  validateSchema(validateVerifySubscribeTransaction),
  subscribeVerifyTransaction,
);

module.exports = router;
