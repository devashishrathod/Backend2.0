const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const { PROMO_CODE_LIMITS } = require("../constants/promoCode");

/**
 * Opening a Razorpay order for a claim.
 *
 * The same inputs the preview takes, and deliberately so: order creation runs
 * the identical builder, and a field accepted by one and dropped by the other
 * would mean the customer is charged for something they were not shown.
 */
exports.validateCreateClaimOrder = {
  body: Joi.object({
    voucherId: objectId().required().messages({
      "any.required": "Voucher ID is required.",
      "any.invalid": "Invalid voucher ID format.",
    }),
    outletId: objectId().required().messages({
      "any.required": "Outlet ID is required.",
      "any.invalid": "Invalid outlet ID format.",
    }),
    billAmount: Joi.number().positive().precision(2).required().messages({
      "number.base": "Bill amount must be a number.",
      "number.positive": "Bill amount must be greater than zero.",
      "any.required": "Bill amount is required.",
    }),
    offerId: objectId().optional().messages({
      "any.invalid": "Invalid offer ID format.",
    }),
    /**
     * Rejected **hard** here, unlike on preview.
     *
     * The preview reports an unusable code softly so the page can render it
     * inline. By the time an order is being opened the customer has seen the
     * price and pressed Pay — charging them full price on a code they believe
     * they applied is not acceptable, so the same rejection becomes a 422.
     */
    promoCode: Joi.string()
      .trim()
      .uppercase()
      .min(PROMO_CODE_LIMITS.MIN_CODE_LENGTH)
      .max(PROMO_CODE_LIMITS.MAX_CODE_LENGTH)
      .pattern(/^[A-Z0-9_-]+$/)
      .allow("", null)
      .optional()
      .messages({
        "string.min": "Promo code must be at least {#limit} characters.",
        "string.max": "Promo code cannot exceed {#limit} characters.",
        "string.pattern.base":
          "Promo code may only contain letters, numbers, dashes and underscores.",
      }),
  }),
};

/**
 * The browser callback after Razorpay's checkout closes.
 *
 * All four fields are required. `transactionId` in particular: the vendor twin
 * once had it optional, which let a verify request through with nothing to
 * verify.
 */
exports.validateVerifyClaimPayment = {
  body: Joi.object({
    razorpayOrderId: Joi.string().trim().required().messages({
      "any.required": "razorpayOrderId is required.",
    }),
    razorpayPaymentId: Joi.string().trim().required().messages({
      "any.required": "razorpayPaymentId is required.",
    }),
    razorpaySignature: Joi.string().trim().required().messages({
      "any.required": "razorpaySignature is required.",
    }),
    transactionId: objectId().required().messages({
      "any.required": "transactionId is required.",
      "any.invalid": "Invalid transactionId.",
    }),
  }),
};

const { VOUCHER_CLAIM_STATUS, CLAIM_CODE } = require("../constants/voucherClaim");
const { PAYMENT_STATUS } = require("../constants");

/**
 * Filters shared by both listings.
 *
 * ⚠️ No `customerId` and no `brandId`-as-identity here on purpose. Scope comes
 * from the token, never from the query string — a listing that accepted an
 * identity filter would let a customer type someone else's id and read their
 * payments. `brandId` IS accepted, but only as a narrowing filter on top of a
 * scope that already restricts the caller, and only an admin has a scope wide
 * enough for it to widen anything.
 */
const listQuery = {
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  from: Joi.date().iso().optional().messages({
    "date.format": "from must be an ISO date, e.g. 2026-08-01",
  }),
  // Inclusive of the whole day — the service widens it to 23:59:59.
  to: Joi.date().iso().optional().messages({
    "date.format": "to must be an ISO date, e.g. 2026-08-31",
  }),
  brandId: objectId().optional(),
  outletId: objectId().optional(),
  voucherId: objectId().optional(),
};

exports.validateListClaimPayments = {
  query: Joi.object({
    ...listQuery,
    status: Joi.string()
      .valid(...Object.values(PAYMENT_STATUS))
      .optional(),
  }),
};

exports.validateListClaims = {
  query: Joi.object({
    ...listQuery,
    // A claim has its own vocabulary, not a payment's.
    status: Joi.string()
      .uppercase()
      .valid(...Object.values(VOUCHER_CLAIM_STATUS))
      .optional()
      .messages({
        "any.only": `status must be one of: ${Object.values(VOUCHER_CLAIM_STATUS).join(", ")}`,
      }),
    claimCode: Joi.string().trim().uppercase().optional(),
  }),
};


/**
 * Opening one payment.
 *
 * Only the id — the scope is the token's job, never the caller's. Validating it
 * as an ObjectId here is what stops a malformed id reaching `findOne` and
 * surfacing as a 500 Mongoose CastError instead of a clean 422.
 */
exports.validateClaimTransactionDetail = {
  params: Joi.object({
    transactionId: objectId().required().messages({
      "any.required": "transactionId is required.",
      "any.invalid": "Invalid transactionId.",
    }),
  }),
};

/**
 * Opening one claim by its id.
 */
exports.validateClaimDetail = {
  params: Joi.object({
    claimId: objectId().required().messages({
      "any.required": "claimId is required.",
      "any.invalid": "Invalid claimId.",
    }),
  }),
};

/**
 * Opening one claim by the code printed at the counter.
 *
 * Shaped against the generated alphabet rather than left as a free string: the
 * code deliberately omits the characters people misread aloud — `0/O`, `1/I/L`,
 * `5/S`, `2/Z`, `8/B` — so a code containing one was mistyped, and saying so is
 * more useful than a 404 that looks like the claim does not exist.
 */
exports.validateClaimByCode = {
  params: Joi.object({
    claimCode: Joi.string()
      .trim()
      .uppercase()
      .pattern(
        new RegExp(`^${CLAIM_CODE.PREFIX}-[${CLAIM_CODE.ALPHABET}]{${CLAIM_CODE.LENGTH}}$`),
      )
      .required()
      .messages({
        "string.pattern.base": `Claim code should look like ${CLAIM_CODE.PREFIX}-XXXXXX. Check for a mistyped character.`,
        "any.required": "claimCode is required.",
      }),
  }),
};
