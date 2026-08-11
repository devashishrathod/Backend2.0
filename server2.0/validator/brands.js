const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const {
  BUSINESS_REGISTRATION_STATUS,
  BUSINESS_ENTITY_TYPE,
  SCREENS,
} = require("../constants");

exports.validateAddBasicDetails = Joi.object({
  currentScreen: Joi.string()
    .uppercase()
    .valid(
      SCREENS.REGISTRATION_STATUS,
      SCREENS.REGISTRATION_ENTITY_TYPE,
      SCREENS.PAN_VERIFICATION,
    )
    .required()
    .messages({
      "any.required": "Current Screen is required",
      "any.only":
        "Current screen must be either REGISTRATION_STATUS, REGISTRATION_ENTITY_TYPE or PAN_VERIFICATION",
      "string.empty": "Current Screen cannot be empty",
    }),
  brandName: Joi.when("currentScreen", {
    is: SCREENS.REGISTRATION_STATUS,
    then: Joi.string().trim().min(2).max(120).optional().messages({
      "string.empty": "Brand Name cannot be empty",
      "string.min": "Brand Name must contain at least {#limit} characters",
      "string.max": "Brand Name cannot exceed {#limit} characters",
    }),
    otherwise: Joi.forbidden(),
  }),
  legalBusinessName: Joi.when("currentScreen", {
    is: SCREENS.REGISTRATION_STATUS,
    then: Joi.string().trim().min(3).max(120).required().messages({
      "any.required": "Legal Business Name is required",
      "string.empty": "Legal Business Name cannot be empty",
      "string.min":
        "Legal Business Name must contain at least {#limit} characters",
      "string.max": "Legal Business Name cannot exceed {#limit} characters",
    }),
    otherwise: Joi.forbidden(),
  }),
  businessRegistrationStatus: Joi.when("currentScreen", {
    is: SCREENS.REGISTRATION_ENTITY_TYPE,
    then: Joi.string()
      .trim()
      .valid(...Object.values(BUSINESS_REGISTRATION_STATUS))
      .required()
      .messages({
        "any.required": "Business Registration Status is required",
        "string.empty": "Business Registration Status cannot be empty",
        "any.only": `Business Registration Status must be one of ${Object.values(BUSINESS_REGISTRATION_STATUS).join(", ")}`,
      }),
    otherwise: Joi.forbidden(),
  }),
  businessEntityType: Joi.when("currentScreen", {
    is: SCREENS.PAN_VERIFICATION,
    then: Joi.string()
      .trim()
      .valid(...Object.values(BUSINESS_ENTITY_TYPE))
      .required()
      .messages({
        "any.required": "Business Entity Type is required",
        "string.empty": "Business Entity Type cannot be empty",
        "any.only": `Business Entity Type must be one of ${Object.values(BUSINESS_ENTITY_TYPE).join(", ")}`,
      }),
    otherwise: Joi.forbidden(),
  }),
});

exports.validateUpdateBasicDetails = Joi.object({
  currentScreen: Joi.string()
    .uppercase()
    .valid(...Object.values(SCREENS))
    .optional()
    .messages({
      "any.only": `Current screen must be one of ${Object.values(SCREENS).join(", ")}`,
      "string.empty": "Current Screen cannot be empty",
    }),
  brandName: Joi.string().trim().min(2).max(120).optional().messages({
    "string.empty": "Brand Name cannot be empty",
    "string.min": "Brand Name must contain at least {#limit} characters",
    "string.max": "Brand Name cannot exceed {#limit} characters",
  }),
  legalBusinessName: Joi.string().trim().min(3).max(120).optional().messages({
    "string.empty": "Legal Business Name cannot be empty",
    "string.min":
      "Legal Business Name must contain at least {#limit} characters",
    "string.max": "Legal Business Name cannot exceed {#limit} characters",
  }),
  businessRegistrationStatus: Joi.string()
    .trim()
    .valid(...Object.values(BUSINESS_REGISTRATION_STATUS))
    .optional()
    .messages({
      "string.empty": "Business Registration Status cannot be empty",
      "any.only": `Business Registration Status must be one of ${Object.values(BUSINESS_REGISTRATION_STATUS).join(", ")}`,
    }),
  businessEntityType: Joi.string()
    .trim()
    .valid(...Object.values(BUSINESS_ENTITY_TYPE))
    .optional()
    .messages({
      "string.empty": "Business Entity Type cannot be empty",
      "any.only": `Business Entity Type must be one of ${Object.values(BUSINESS_ENTITY_TYPE).join(", ")}`,
    }),
});

exports.validateGetBrand = {
  query: Joi.object({
    brandId: objectId().messages({
      "any.invalid": "Invalid brandId",
    }),
  }),
};

exports.validateUpdateBrand = {
  query: {
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid Brand ID format",
    }),
  },
  body: {
    brandName: Joi.string().trim().min(2).max(150).optional().messages({
      "string.empty": "Brand name can't be empty",
      "string.min": "Brand name must be at least 2 characters",
      "string.max": "Brand name cannot exceed 150 characters",
    }),
    email: Joi.string().trim().lowercase().email().optional().messages({
      "string.empty": "Email can't be empty",
      "string.email": "Please enter a valid email address",
    }),
    joinedDate: Joi.date().optional().messages({
      "date.base": "Please enter a valid joined date",
    }),
    description: Joi.string().trim().optional().messages({
      "string.empty": "Description can't be empty",
    }),
    isActive: Joi.alternatives().try(Joi.string(), Joi.boolean()).optional(),
    isOnboarding: Joi.boolean().optional().default(false),
    subCategoryId: Joi.when("isOnboarding", {
      is: true,
      then: objectId().required().messages({
        "any.required": "Sub-category ID is required during onboarding",
        "any.invalid": "Invalid Sub-category ID format",
      }),
      otherwise: objectId().optional().messages({
        "any.invalid": "Invalid Sub-category ID format",
      }),
    }),
  },
};
