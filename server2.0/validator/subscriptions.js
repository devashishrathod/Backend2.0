const Joi = require("joi");
const { SUBSCRIPTION_TYPES } = require("../constants");
const { DISCOUNT_TYPES } = require("../constants/subscription");

// A metered pool. `isUnlimited` wins, so a limit alongside it is ignored.
const meteredEntitlement = Joi.object({
  limit: Joi.number().integer().min(0).optional().messages({
    "number.min": "limit cannot be negative",
  }),
  isUnlimited: Joi.boolean().optional(),
});

const flagEntitlement = Joi.object({
  isEnabled: Joi.boolean().optional(),
});

/**
 * Structured, enforceable plan limits.
 *
 * Fixed key set on purpose (and `stripUnknown` is already on globally), so an
 * admin cannot invent a key that silently enforces nothing. This is what the
 * gates read — `features[]` below stays free-text and display-only.
 */
const entitlements = Joi.object({
  subBrands: meteredEntitlement.optional(),
  franchises: meteredEntitlement.optional(),
  vouchers: flagEntitlement.optional(),
  dealPack: flagEntitlement.optional(),
  prioritySupport: flagEntitlement.optional(),
  showcase: flagEntitlement.optional(),
});

const features = Joi.array()
  .items(
    Joi.object({
      title: Joi.string().trim().required(),
      value: Joi.string().trim().allow("").optional(),
      available: Joi.boolean().optional(),
    }),
  )
  .optional();

const discountFields = {
  discountType: Joi.string()
    .valid(...Object.values(DISCOUNT_TYPES))
    .optional()
    .messages({
      "any.only": `discountType must be one of: ${Object.values(DISCOUNT_TYPES).join(", ")}`,
    }),
  discountPercent: Joi.number().min(0).max(100).optional().messages({
    "number.min": "discountPercent must be at least {#limit}",
    "number.max": "discountPercent cannot exceed {#limit}",
  }),
  discountAmount: Joi.number().min(0).optional().messages({
    "number.min": "discountAmount cannot be negative",
  }),
  // Cosmetic "was ₹X" figure for the plan card; never used in any maths.
  strikePrice: Joi.number().min(0).optional().messages({
    "number.min": "strikePrice cannot be negative",
  }),
};

exports.validateCreateSubscription = Joi.object({
  name: Joi.string().trim().min(3).max(120).required().messages({
    "string.min": "Name has minimum {#limit} characters",
    "string.max": "Name cannot exceed {#limit} characters",
  }),
  description: Joi.string().allow("").max(500).messages({
    "string.max": "Description cannot exceed {#limit} characters",
  }),
  price: Joi.number().min(0).required().messages({
    "number.min": "Price must be at least {#limit}",
    "any.required": "Price is required",
  }),
  type: Joi.string()
    .valid(...Object.values(SUBSCRIPTION_TYPES))
    .required(),
  durationInDays: Joi.number().optional(),
  durationInYears: Joi.number().min(0).optional(),
  benefits: Joi.array().items(Joi.string()).optional(),
  limitations: Joi.array().items(Joi.string()).optional(),
  features,
  entitlements: entitlements.optional(),
  ...discountFields,
  isActive: Joi.boolean().optional(),
});

exports.validateUpdateSubscription = Joi.object({
  name: Joi.string().trim().min(3).max(120).optional().messages({
    "string.min": "Name has minimum {#limit} characters",
    "string.max": "Name cannot exceed {#limit} characters",
  }),
  description: Joi.string().allow("").max(500).optional().messages({
    "string.max": "Description cannot exceed {#limit} characters",
  }),
  price: Joi.number().min(0).optional().messages({
    "number.min": "Price must be at least {#limit}",
  }),
  type: Joi.string()
    .valid(...Object.values(SUBSCRIPTION_TYPES))
    .optional(),
  durationInDays: Joi.number().optional(),
  durationInYears: Joi.number().min(0).optional(),
  benefits: Joi.array().items(Joi.string()).optional(),
  limitations: Joi.array().items(Joi.string()).optional(),
  features,
  entitlements: entitlements.optional(),
  ...discountFields,
  isActive: Joi.boolean().optional(),
});

exports.validateGetAllSubscriptions = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).optional(),
    search: Joi.string().trim().allow("").optional(),
    type: Joi.string()
      .valid(...Object.values(SUBSCRIPTION_TYPES))
      .optional(),
    isActive: Joi.alternatives()
      .try(Joi.boolean(), Joi.string().valid("true", "false"))
      .optional(),
    sortBy: Joi.string().valid("price", "name", "createdAt").optional(),
    sortOrder: Joi.string().valid("asc", "desc").optional(),
  }),
};
