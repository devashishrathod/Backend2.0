const Joi = require("joi");
const { OUTLET_TYPES } = require("../constants");
const objectId = require("./validJoiObjectId");

exports.validateWhatsappSubBrandSignUp = Joi.object({
  brandId: objectId().required().messages({
    "any.required": "Brand ID is required",
    "any.invalid": "Invalid Brand ID format",
  }),
  whatsappNumber: Joi.string()
    .trim()
    .pattern(/^[6-9]\d{9}$/)
    .required()
    .messages({
      "string.empty": "WhatsApp number is required",
      "string.pattern.base": "Please enter a valid 10 digit WhatsApp number",
      "any.required": "WhatsApp number is required",
    }),
  isFirstOutlet: Joi.alternatives()
    .try(Joi.string(), Joi.boolean())
    .default(false),
});

exports.validateUpdateSubBrand = {
  params: {
    subBrandId: objectId().required().messages({
      "any.required": "Brand ID is required",
      "any.invalid": "Invalid Brand ID format",
    }),
  },
  body: {
    email: Joi.string().trim().lowercase().email().optional().messages({
      "string.empty": "Email can't be empty",
      "string.email": "Please enter a valid email address",
    }),
    outletType: Joi.string()
      .valid(...Object.values(OUTLET_TYPES))
      .optional()
      .messages({
        "string.empty": "Outlet type can't be empty",
      }),
    joinedDate: Joi.date().optional(),
    description: Joi.string().optional().messages({
      "any.empty": "Description can't be empty",
    }),
    isActive: Joi.alternatives().try(Joi.string(), Joi.boolean()).default(true),
  },
};

exports.validateGetAllSubBrands = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    search: Joi.string().trim().optional(),
    userId: objectId().optional().messages({
      "any.invalid": "Invalid User ID format",
    }),
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid Brand ID format",
    }),
    locationId: objectId().optional().messages({
      "any.invalid": "Invalid Location ID format",
    }),
    workHoursId: objectId().optional().messages({
      "any.invalid": "Invalid Work Hours ID format",
    }),
    outletType: Joi.string()
      .valid(...Object.values(OUTLET_TYPES))
      .optional()
      .messages({
        "string.empty": "Outlet type can't be empty",
      }),
    email: Joi.string().trim().optional(),
    mobile: Joi.string().trim().optional(),
    whatsappNumber: Joi.string().trim().optional(),
    uniqueId: Joi.string().trim().optional(),
    storeId: Joi.string().trim().optional(),
    isActive: Joi.alternatives().try(Joi.string(), Joi.boolean()).optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    sortBy: Joi.string()
      .valid("joinedDate", "createdAt", "updatedAt", "outletType", "isActive")
      .optional(),
    sortOrder: Joi.string().valid("asc", "desc").optional().default("desc"),
  }),
};
