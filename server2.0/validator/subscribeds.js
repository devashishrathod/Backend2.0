const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const {
  SUBSCRIBED_STATUS,
  SUBSCRIPTION_SOURCE,
  MANUAL_PAYMENT_MODES,
  SUBSCRIPTION_HISTORY_ACTION,
} = require("../constants/subscription");

exports.validateAdminGrantSubscription = {
  body: Joi.object({
    brandId: objectId().required().messages({
      "any.required": "brandId is required",
      "any.invalid": "Invalid brandId",
    }),
    subscriptionId: objectId().required().messages({
      "any.required": "subscriptionId is required",
      "any.invalid": "Invalid subscriptionId",
    }),
    startDate: Joi.date().optional().messages({
      "date.base": "startDate must be a valid date",
    }),
    // Overrides the plan's own duration — for a bespoke or pro-rated term.
    durationInDays: Joi.number().integer().min(1).max(3650).optional().messages({
      "number.min": "durationInDays must be at least {#limit}",
      "number.max": "durationInDays cannot exceed {#limit}",
    }),
    paymentMode: Joi.string()
      .valid(...Object.values(MANUAL_PAYMENT_MODES))
      .default(MANUAL_PAYMENT_MODES.FREE)
      .messages({
        "any.only": `paymentMode must be one of: ${Object.values(MANUAL_PAYMENT_MODES).join(", ")}`,
      }),
    // What was actually collected offline. Ignored for a FREE grant.
    collectedAmount: Joi.number().min(0).optional().messages({
      "number.min": "collectedAmount cannot be negative",
    }),
    referenceNumber: Joi.string().trim().max(80).optional().messages({
      "string.max": "referenceNumber cannot exceed {#limit} characters",
    }),
    // Change the tier but keep the validity the vendor already paid for.
    keepCurrentEndDate: Joi.boolean().default(false),
    // Required: a manual grant must always say why it was given.
    note: Joi.string().trim().min(3).max(500).required().messages({
      "any.required": "A note explaining this manual grant is required",
      "string.min": "note must be at least {#limit} characters",
      "string.max": "note cannot exceed {#limit} characters",
    }),
  }),
};

exports.validateAdminCancelSubscription = {
  body: Joi.object({
    brandId: objectId().required().messages({
      "any.required": "brandId is required",
      "any.invalid": "Invalid brandId",
    }),
    reason: Joi.string().trim().min(3).max(500).required().messages({
      "any.required": "A reason for cancelling is required",
      "string.min": "reason must be at least {#limit} characters",
      "string.max": "reason cannot exceed {#limit} characters",
    }),
  }),
};

exports.validateGetBrandSubscription = {
  query: Joi.object({
    // Optional for a vendor (their own brand); required for an admin.
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid brandId",
    }),
  }),
};

exports.validateGetSubscribedHistory = {
  query: Joi.object({
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid brandId",
    }),
    action: Joi.string()
      .valid(...Object.values(SUBSCRIPTION_HISTORY_ACTION))
      .optional(),
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
  }),
};

exports.validateGetAllSubscribeds = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    search: Joi.string().trim().allow("").optional(),
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid brandId",
    }),
    subscriptionId: objectId().optional().messages({
      "any.invalid": "Invalid subscriptionId",
    }),
    status: Joi.string()
      .valid(...Object.values(SUBSCRIBED_STATUS))
      .optional(),
    source: Joi.string()
      .valid(...Object.values(SUBSCRIPTION_SOURCE))
      .optional(),
    // Renewals worklist: active plans ending within N days.
    expiringInDays: Joi.number().integer().min(1).max(365).optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    sortBy: Joi.string()
      .valid("createdAt", "endDate", "startDate", "paidAmount")
      .optional(),
    sortOrder: Joi.string().valid("asc", "desc").optional(),
  }),
};

exports.validateGetForfeitedSubscriptions = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid brandId",
    }),
    // Default view is the actionable set: forfeits not yet settled.
    compensated: Joi.alternatives()
      .try(Joi.boolean(), Joi.string().valid("true", "false"))
      .optional(),
    // Ignore trivial forfeits, e.g. only show 7+ days lost.
    minDays: Joi.number().integer().min(1).optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    sortBy: Joi.string()
      .valid("forfeitedValue", "forfeitedDays", "upgradeDate")
      .optional(),
    sortOrder: Joi.string().valid("asc", "desc").optional(),
  }),
};

exports.validateCompensateForfeit = {
  body: Joi.object({
    subscribedId: objectId().required().messages({
      "any.required": "subscribedId is required",
      "any.invalid": "Invalid subscribedId",
    }),
    note: Joi.string().trim().min(3).max(500).required().messages({
      "any.required": "A note describing the compensation is required",
      "string.min": "note must be at least {#limit} characters",
      "string.max": "note cannot exceed {#limit} characters",
    }),
  }),
};

exports.validateResyncBrandSubscription = {
  body: Joi.object({
    brandId: objectId().required().messages({
      "any.required": "brandId is required",
      "any.invalid": "Invalid brandId",
    }),
  }),
};
