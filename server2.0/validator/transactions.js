const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const {
  RAZORPAY_WEBHOOK_EVENTS,
  WEBHOOK_STATUS,
  DISPUTE_STATUS,
} = require("../constants/webhook");
const {
  RAZORPAY_ACCOUNTS,
  TRANSACTION_PURPOSE,
} = require("../constants/transaction");

// Shared by preview and order creation so the two can never accept different
// inputs. Note there is deliberately no `amount` field: the payable amount is
// computed server-side from the plan and the admin's tax settings. It used to
// be accepted here and applied as `amount || price`, which let a caller buy any
// plan for ₹1.
const checkoutFields = {
  subscriptionId: objectId().required().messages({
    "any.required": "subscriptionId is required",
    "any.invalid": "Invalid subscriptionId",
  }),
  // Optional for a vendor (their own brand is used); required for an admin.
  brandId: objectId().optional().messages({
    "any.invalid": "Invalid brandId",
  }),
  email: Joi.string().email().optional().messages({
    "string.email": "Invalid email format",
  }),
  whatsappNumber: Joi.string().optional().messages({
    "string.base": "Invalid whatsappNumber format",
  }),
  // Accepted so the checkout page can surface a clear "not available yet"
  // message instead of silently charging full price.
  // See docs/subscription_future_updates.md
  promoCode: Joi.string().trim().uppercase().max(40).optional().messages({
    "string.max": "Promo code cannot exceed {#limit} characters",
  }),
};

exports.validateSubscribePreview = Joi.object(checkoutFields);

exports.validateCreateSubscribeOrder = Joi.object(checkoutFields);

exports.validateVerifySubscribeTransaction = Joi.object({
  razorpayPaymentId: Joi.string().required().messages({
    "any.required": "razorpayPaymentId is required",
  }),
  razorpayOrderId: Joi.string().required().messages({
    "any.required": "razorpayOrderId is required",
  }),
  razorpaySignature: Joi.string().required().messages({
    "any.required": "razorpaySignature is required",
  }),
  // Was optional, which let a verify request through with nothing to verify.
  transactionId: objectId().required().messages({
    "any.required": "transactionId is required",
    "any.invalid": "Invalid transactionId",
  }),
});

exports.validateRegenerateInvoice = {
  body: Joi.object({
    transactionId: objectId().required().messages({
      "any.required": "transactionId is required",
      "any.invalid": "Invalid transactionId",
    }),
  }),
};

// ---------------------------------------------------------------------------
// Webhook operations (admin)
// ---------------------------------------------------------------------------

// Accepts either Razorpay's event id or our own WebhookEvent _id, since an admin
// reading the listing has the latter to hand.
const webhookEventIdRule = Joi.string().trim().min(3).max(200).required().messages({
  "any.required": "eventId is required",
});

exports.validateGetWebhookEvents = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    // Omitted defaults to FAILED — the actionable set. "ALL" opts out.
    status: Joi.string()
      .valid(...Object.values(WEBHOOK_STATUS), "ALL")
      .optional()
      .messages({
        "any.only": `status must be one of: ${Object.values(WEBHOOK_STATUS).join(", ")}, ALL`,
      }),
    event: Joi.string()
      .valid(...Object.values(RAZORPAY_WEBHOOK_EVENTS))
      .optional(),
    transactionId: objectId().optional().messages({
      "any.invalid": "Invalid transactionId",
    }),
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid brandId",
    }),
    razorpayOrderId: Joi.string().trim().optional(),
    // Which Razorpay account the delivery arrived on, and which money flow it
    // belongs to. `stripUnknown` is on, so a filter that is not declared here
    // is silently dropped rather than rejected — which would look like the
    // filter simply not working.
    account: Joi.string()
      .valid(...Object.values(RAZORPAY_ACCOUNTS))
      .optional()
      .messages({
        "any.only": `account must be one of: ${Object.values(RAZORPAY_ACCOUNTS).join(", ")}`,
      }),
    purpose: Joi.string()
      .valid(...Object.values(TRANSACTION_PURPOSE))
      .optional()
      .messages({
        "any.only": `purpose must be one of: ${Object.values(TRANSACTION_PURPOSE).join(", ")}`,
      }),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    sortOrder: Joi.string().valid("asc", "desc").optional(),
  }),
};

exports.validateGetWebhookEvent = {
  params: Joi.object({ eventId: webhookEventIdRule }),
};

exports.validateReplayWebhookEvent = {
  params: Joi.object({ eventId: webhookEventIdRule }),
  body: Joi.object({
    // Only needed to re-run something already PROCESSED, which is almost always
    // a mistake — hence the explicit opt-in.
    force: Joi.boolean().default(false),
  }),
};

exports.validateGetDisputes = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    status: Joi.string()
      .valid(...Object.values(DISPUTE_STATUS))
      .optional(),
    // Omitted shows only unresolved disputes.
    resolved: Joi.alternatives()
      .try(Joi.boolean(), Joi.string().valid("true", "false"))
      .optional(),
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid brandId",
    }),
    sortOrder: Joi.string().valid("asc", "desc").optional(),
  }),
};
