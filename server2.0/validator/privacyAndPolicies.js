const Joi = require("joi");

exports.validateCreatePrivacyAndPolicy = (data) => {
  const createSchema = Joi.object({
    title: Joi.string().min(3).max(120).required().messages({
      "string.min": "Title has minimum {#limit} characters",
      "string.max": "Title cannot exceed {#limit} characters",
    }),
    description: Joi.string().allow("").max(300).messages({
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
    description: Joi.string().allow("").max(300).messages({
      "string.max": "Description cannot exceed {#limit} characters",
    }),
    isActive: Joi.boolean().optional(),
  });
  return updateSchema.validate(payload, { abortEarly: false });
};

exports.validateGetAllPrivacyAndPoliciesQuery = (payload) => {
  const getAllQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).optional(),
    search: Joi.string().optional(),
    title: Joi.string().optional(),
    isActive: Joi.alternatives().try(Joi.string(), Joi.boolean()).optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    sortBy: Joi.string().optional(),
    sortOrder: Joi.string().valid("asc", "desc").optional(),
  });
  return getAllQuerySchema.validate(payload, { abortEarly: false });
};
