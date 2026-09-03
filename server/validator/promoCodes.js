const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const {
  PROMO_DISCOUNT_TYPES,
  PROMO_APPLICABLE_ACTIONS,
  PROMO_CODE_LIMITS,
  REPORT_GROUP_BY,
  PROMO_AUDIENCE,
  PROMO_APPLIES_TO,
  PROMO_COST_BEARING_MODE,
} = require("../constants/promoCode");

const codeRule = Joi.string()
  .trim()
  .uppercase()
  .min(PROMO_CODE_LIMITS.MIN_CODE_LENGTH)
  .max(PROMO_CODE_LIMITS.MAX_CODE_LENGTH)
  // Letters, digits, dash and underscore only — anything else is a pain to
  // read out loud, type on a phone, or put in a campaign.
  .pattern(/^[A-Z0-9_-]+$/)
  .messages({
    "string.min": "Code must be at least {#limit} characters",
    "string.max": "Code cannot exceed {#limit} characters",
    "string.pattern.base":
      "Code may only contain letters, numbers, dashes and underscores",
  });

const sharedFields = {
  description: Joi.string()
    .trim()
    .allow("")
    .max(PROMO_CODE_LIMITS.MAX_DESCRIPTION_LENGTH)
    .optional()
    .messages({
      "string.max": "Description cannot exceed {#limit} characters",
    }),
  discountPercent: Joi.number().min(0).max(100).optional().messages({
    "number.max": "discountPercent cannot exceed {#limit}",
  }),
  discountAmount: Joi.number().min(0).optional().messages({
    "number.min": "discountAmount cannot be negative",
  }),
  // Caps a PERCENT code, e.g. "20% off up to ₹1,000".
  maxDiscountAmount: Joi.number().min(1).optional(),
  // Compared against the plan-discounted subtotal, not the list price.
  minOrderValue: Joi.number().min(0).optional(),
  subscriptionIds: Joi.array().items(objectId()).optional().messages({
    "any.invalid": "Invalid subscriptionId in subscriptionIds",
  }),
  applicableActions: Joi.array()
    .items(Joi.string().valid(...Object.values(PROMO_APPLICABLE_ACTIONS)))
    .optional()
    .messages({
      "any.only": `applicableActions may only contain: ${Object.values(PROMO_APPLICABLE_ACTIONS).join(", ")}`,
    }),
  firstTimeOnly: Joi.boolean().optional(),

  // ---------- audience ----------
  // Which checkout the code belongs to. Defaults to VENDOR on write; the two
  // audiences never see each other's codes.
  audience: Joi.string()
    .valid(...Object.values(PROMO_AUDIENCE))
    .optional()
    .messages({
      "any.only": `audience must be one of: ${Object.values(PROMO_AUDIENCE).join(", ")}`,
    }),

  // ---------- customer scope ----------
  // Joi only checks shape. Which audience each of these belongs to, and the
  // costBearing rules, are cross-field and live in `assertCoherent` — which is
  // also the only place that can see the STORED document on a PATCH.
  voucherIds: Joi.array().items(objectId()).optional().messages({
    "any.invalid": "Invalid voucherId in voucherIds",
  }),
  brandIds: Joi.array().items(objectId()).optional().messages({
    "any.invalid": "Invalid brandId in brandIds",
  }),
  categoryIds: Joi.array().items(objectId()).optional().messages({
    "any.invalid": "Invalid categoryId in categoryIds",
  }),
  perCustomerUsageLimit: Joi.number().integer().min(1).optional(),
  firstOrderOnly: Joi.boolean().optional(),
  // Compared against the raw bill the customer typed, before any offer.
  minBillAmount: Joi.number().min(0).optional(),
  appliesTo: Joi.string()
    .valid(...Object.values(PROMO_APPLIES_TO))
    .optional()
    .messages({
      "any.only": `appliesTo must be one of: ${Object.values(PROMO_APPLIES_TO).join(", ")}`,
    }),

  // ---------- who funds the discount ----------
  costBearing: Joi.object({
    mode: Joi.string()
      .valid(...Object.values(PROMO_COST_BEARING_MODE))
      .optional()
      .messages({
        "any.only": `costBearing.mode must be one of: ${Object.values(PROMO_COST_BEARING_MODE).join(", ")}`,
      }),
    vendorPercent: Joi.number().min(0).max(100).optional(),
  }).optional(),

  validFrom: Joi.date().optional(),
  validTill: Joi.date().optional(),
  totalUsageLimit: Joi.number().integer().min(1).optional(),
  perBrandUsageLimit: Joi.number().integer().min(1).optional(),
  isActive: Joi.boolean().optional(),
};

// Reused by the listing and the report — both must be able to scope by audience
// or they silently mix two campaigns with different economics.
const audienceQueryRule = Joi.string()
  .valid(...Object.values(PROMO_AUDIENCE))
  .optional()
  .messages({
    "any.only": `audience must be one of: ${Object.values(PROMO_AUDIENCE).join(", ")}`,
  });

exports.validateCreatePromoCode = {
  body: Joi.object({
    code: codeRule.required().messages({
      "any.required": "Code is required",
    }),
    discountType: Joi.string()
      .valid(...Object.values(PROMO_DISCOUNT_TYPES))
      .required()
      .messages({
        "any.required": "discountType is required",
        "any.only": `discountType must be one of: ${Object.values(PROMO_DISCOUNT_TYPES).join(", ")}`,
      }),
    ...sharedFields,
  }),
};

exports.validateUpdatePromoCode = {
  params: Joi.object({
    id: objectId().required().messages({
      "any.required": "Promo code id is required",
      "any.invalid": "Invalid promo code id",
    }),
  }),
  body: Joi.object({
    discountType: Joi.string()
      .valid(...Object.values(PROMO_DISCOUNT_TYPES))
      .optional(),
    ...sharedFields,
  })
    .min(1)
    .messages({
      "object.min": "Please provide at least one field to update.",
    }),
};

exports.validateGetPromoCode = {
  params: Joi.object({
    id: objectId().required().messages({
      "any.invalid": "Invalid promo code id",
    }),
  }),
};

exports.validateDeletePromoCode = exports.validateGetPromoCode;

exports.validateGetAllPromoCodes = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    search: Joi.string().trim().allow("").optional(),
    isActive: Joi.alternatives()
      .try(Joi.boolean(), Joi.string().valid("true", "false"))
      .optional(),
    // Effective state, which the stored flags alone do not express.
    status: Joi.string().valid("LIVE", "SCHEDULED", "EXPIRED").optional(),
    audience: audienceQueryRule,
    sortBy: Joi.string()
      .valid("createdAt", "code", "usedCount", "validTill")
      .optional(),
    sortOrder: Joi.string().valid("asc", "desc").optional(),
  }),
};

/**
 * Campaign report. Every filter is optional: with none of them this reports on
 * every code over all time, which is the dashboard-landing case.
 */
exports.validatePromoCodeReport = {
  query: Joi.object({
    // Either identifier works. `code` is what an admin actually remembers.
    promoCodeId: objectId().optional().messages({
      "any.invalid": "Invalid promoCodeId",
    }),
    code: Joi.string().trim().uppercase().optional(),
    audience: audienceQueryRule,
    from: Joi.date().iso().optional().messages({
      "date.format": "from must be an ISO date, e.g. 2026-08-01",
    }),
    // Inclusive of the whole day - the service widens it to 23:59:59.
    to: Joi.date().iso().optional().messages({
      "date.format": "to must be an ISO date, e.g. 2026-08-31",
    }),
    groupBy: Joi.string()
      .lowercase()
      .valid(...Object.values(REPORT_GROUP_BY))
      .optional()
      .messages({
        "any.only": `groupBy must be one of: ${Object.values(REPORT_GROUP_BY).join(", ")}`,
      }),
  }).messages({
    "object.unknown": "Unknown query parameter",
  }),
};
