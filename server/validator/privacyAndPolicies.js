const Joi = require("joi");

// Same reasoning as the terms schema — legal copy does not fit in 300 chars.
const MAX_DESCRIPTION = 50000;

const typeRule = Joi.string().trim().max(40).messages({
  "string.max": "Type cannot exceed {#limit} characters",
});

exports.validateCreatePrivacyAndPolicy = (data) => {
  const createSchema = Joi.object({
    title: Joi.string().min(3).max(120).required().messages({
      "string.min": "Title has minimum {#limit} characters",
      "string.max": "Title cannot exceed {#limit} characters",
      "any.required": "Title is required",
    }),
    // Mandatory on the model but absent here, so every create failed on
    // "Path `type` is required." — see validator/termsAndConditions.js.
    type: typeRule.required().messages({
      "any.required": "Type is required",
      "string.max": "Type cannot exceed {#limit} characters",
    }),
    description: Joi.string().allow("").max(MAX_DESCRIPTION).messages({
      "string.max": "Description cannot exceed {#limit} characters",
    }),
    isActive: Joi.boolean().optional(),
  });
  return createSchema.validate(data, { abortEarly: false });
};

exports.validateUpdatePrivacyAndPolicy = (payload) => {
  const updateSchema = Joi.object({
    title: Joi.string().min(3).max(120).messages({
      "string.min": "Title has minimum {#limit} characters",
      "string.max": "Title cannot exceed {#limit} characters",
    }),
    type: typeRule.optional(),
    description: Joi.string().allow("").max(MAX_DESCRIPTION).messages({
      "string.max": "Description cannot exceed {#limit} characters",
    }),
    isActive: Joi.boolean().optional(),
  })
    .min(1)
    .messages({
      "object.min": "Please provide at least one field to update.",
    });
  return updateSchema.validate(payload, { abortEarly: false });
};

exports.validateGetAllPrivacyAndPoliciesQuery = (payload) => {
  const getAllQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).optional(),
    search: Joi.string().optional(),
    title: Joi.string().optional(),
    type: typeRule.optional(),
    isActive: Joi.alternatives().try(Joi.string(), Joi.boolean()).optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    sortBy: Joi.string().optional(),
    sortOrder: Joi.string().valid("asc", "desc").optional(),
  });
  return getAllQuerySchema.validate(payload, { abortEarly: false });
};

exports.MAX_DESCRIPTION = MAX_DESCRIPTION;
