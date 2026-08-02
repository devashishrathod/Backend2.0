const Joi = require("joi");
const objectId = require("./validJoiObjectId");

exports.validateCreateSubscribeOrder = Joi.object({
  brandId: objectId().required().messages({
    "any.required": "brandId is required",
    "any.invalid": "Invalid brandId",
  }),
  subscriptionId: objectId().required().messages({
    "any.required": "subscriptionId is required",
    "any.invalid": "Invalid subscriptionId",
  }),
  email: Joi.string().email().optional().messages({
    "string.email": "Invalid email format",
  }),
  whatsappNumber: Joi.string().optional().messages({
    "string.base": "Invalid whatsappNumber format",
  }),
  currency: Joi.string().valid("INR").optional().default("INR").messages({
    "any.only": "Currency must be 'INR'",
  }),
  amount: Joi.number().min(0).optional().messages({
    "number.min": "Amount must be at least {#limit}",
    "number.base": "Amount must be a number",
  }),
});

exports.validateVerifySubscribeTransaction = Joi.object({
  razorpayPaymentId: Joi.string().required().messages({
    "any.required": "razorpay_payment_id is required",
  }),
  razorpayOrderId: Joi.string().required().messages({
    "any.required": "razorpay_order_id is required",
  }),
  razorpaySignature: Joi.string().required().messages({
    "any.required": "razorpay_signature is required",
  }),
  transactionId: objectId().messages({
    "any.invalid": "Invalid transactionId",
  }),
});
