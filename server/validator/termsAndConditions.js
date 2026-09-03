const Joi = require("joi");

// Legal copy is long-form and often carries markup. The old ceiling was 300 —
// copied from the category description — which no real terms document fits in.
const MAX_DESCRIPTION = 50000;

// Free-text on the model, but it is what the client filters on to decide which
// audience a document belongs to ("VENDOR", "CUSTOMER", …).
const typeRule = Joi.string().trim().max(40).messages({
  "string.max": "Type cannot exceed {#limit} characters",
});

exports.validateCreateTermAndCondition = (data) => {
  const createSchema = Joi.object({
    title: Joi.string().min(3).max(120).required().messages({
      "string.min": "Title has minimum {#limit} characters",
      "string.max": "Title cannot exceed {#limit} characters",
      "any.required": "Title is required",
    }),
    // `type` is `required: true` on the model but was missing from this schema
    // entirely, so `stripUnknown` removed it even when a caller sent it and
    // every create failed on "Path `type` is required."
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

exports.validateUpdateTermAndCondition = (payload) => {
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

exports.validateGetAllTermsAndConditionsQuery = (payload) => {
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
