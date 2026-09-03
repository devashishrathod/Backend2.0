const Joi = require("joi");
const objectId = require("./validJoiObjectId");

exports.validateAddBrandFeature = {
  body: Joi.object({
    brandId: objectId().required().messages({
      "any.required": "Brand ID is required",
      "any.invalid": "Invalid Brand ID format",
    }),
    title: Joi.string().trim().min(2).max(150).required().messages({
      "any.required": "Feature title is required",
      "string.empty": "Feature title can't be empty",
      "string.min": "Feature title must be at least 2 characters",
      "string.max": "Feature title cannot exceed 150 characters",
    }),
    description: Joi.string().trim().max(500).optional().allow("").messages({
      "string.max": "Feature description cannot exceed 500 characters",
    }),
    isActive: Joi.alternatives()
      .try(Joi.string(), Joi.boolean())
      .optional()
      .default(true),
  }),
};

exports.validateUpdateBrandFeature = {
  params: {
    featureId: objectId().required().messages({
      "any.required": "Feature ID is required",
      "any.invalid": "Invalid Feature ID format",
    }),
  },
  body: Joi.object({
    title: Joi.string().trim().min(2).max(150).optional().messages({
      "string.empty": "Feature title can't be empty",
      "string.min": "Feature title must be at least 2 characters",
      "string.max": "Feature title cannot exceed 150 characters",
    }),
    description: Joi.string().trim().max(500).optional().allow("").messages({
      "string.max": "Feature description cannot exceed 500 characters",
    }),
    isActive: Joi.alternatives().try(Joi.string(), Joi.boolean()).optional(),
  }),
};

exports.validateGetBrandFeature = {
  params: {
    featureId: objectId().required().messages({
      "any.required": "Feature ID is required",
      "any.invalid": "Invalid Feature ID format",
    }),
  },
};

exports.validateGetAllBrandFeatures = {
  query: Joi.object({
    brandId: objectId().required().messages({
      "any.required": "Brand ID is required",
      "any.invalid": "Invalid Brand ID format",
    }),
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    search: Joi.string().trim().optional(),
    isActive: Joi.alternatives().try(Joi.string(), Joi.boolean()).optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    sortBy: Joi.string()
      .valid("title", "createdAt", "updatedAt", "isActive")
      .optional(),
    sortOrder: Joi.string().valid("asc", "desc").optional().default("desc"),
  }),
};

exports.validateDeleteBrandFeature = {
  params: {
    featureId: objectId().required().messages({
      "any.required": "Feature ID is required",
      "any.invalid": "Invalid Feature ID format",
    }),
  },
};
