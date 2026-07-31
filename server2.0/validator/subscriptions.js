const Joi = require("joi");
const { SUBSCRIPTION_TYPES } = require("../constants");

exports.validateCreateSubscription = Joi.object({
  name: Joi.string().trim().min(3).max(120).required().messages({
    "string.min": "Name has minimum {#limit} characters",
    "string.max": "Name cannot exceed {#limit} characters",
  }),
  description: Joi.string().allow("").max(500).messages({
    "string.max": "Description cannot exceed {#limit} characters",
  }),
  price: Joi.number().min(0).required().messages({
    "string.min": "Price must be at least {#limit}",
    "any.required": "Price is required",
  }),
  type: Joi.string()
    .valid(...Object.values(SUBSCRIPTION_TYPES))
    .required(),
  durationInDays: Joi.number().optional(),
  benefits: Joi.array().items(Joi.string()).optional(),
  limitations: Joi.array().items(Joi.string()).optional(),
  features: Joi.array()
    .items(
      Joi.object({
        title: Joi.string().trim().required(),
        value: Joi.string().trim().allow("").optional(),
        available: Joi.boolean().optional(),
      }),
    )
    .optional(),
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
    "string.min": "Price must be at least {#limit}",
  }),
  type: Joi.string()
    .valid(...Object.values(SUBSCRIPTION_TYPES))
    .optional(),
  durationInDays: Joi.number().optional(),
  benefits: Joi.array().items(Joi.string()).optional(),
  limitations: Joi.array().items(Joi.string()).optional(),
  features: Joi.array()
    .items(
      Joi.object({
        title: Joi.string().trim().required(),
        value: Joi.string().trim().allow("").optional(),
        available: Joi.boolean().optional(),
      }),
    )
    .optional(),
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
