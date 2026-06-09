const Joi = require("joi");
const {
  BUSINESS_REGISTRATION_STATUS,
  BUSINESS_ENTITY_TYPE,
  SCREENS,
} = require("../constants");

exports.validateBasicDetails = Joi.object({
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
        "any.only":
          "Business Registration Status must be either REGISTERED or UNREGISTERED",
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
        "any.only":
          "Business Entity Type must be either PROPRIETORSHIP, PARTNERSHIP, LLP, PRIVATE_LIMITED, PUBLIC_LIMITED, ONE_PERSON_COMPANY, TRUST, NGO or SOCIETY",
      }),
    otherwise: Joi.forbidden(),
  }),
});
