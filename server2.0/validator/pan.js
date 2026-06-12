const Joi = require("joi");
const {
  PAN_TYPES,
  GENDERS,
  PRIMARY_VERIFICATION_PROVIDERS,
  PRIMARY_VERIFICATION_STATUSES,
  SCREENS,
} = require("../constants");

exports.validateAddPanDetails = Joi.object({
  pan: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
    .required()
    .messages({
      "string.empty": "PAN Number cannot be empty",
      "string.pattern.base": "Please enter a valid PAN Number",
      "any.required": "PAN Number is required",
    }),
  panType: Joi.string()
    .trim()
    .valid(...Object.values(PAN_TYPES))
    .required()
    .messages({
      "string.empty": "PAN type cannot be empty",
      "any.required": "PAN type is required",
      "any.only": `PAN type must be one of ${Object.values(PAN_TYPES).join(", ")}`,
    }),
  fullName: Joi.string().trim().min(3).required().messages({
    "string.empty": "Full name cannot be empty",
    "any.required": "Full name is required",
    "string.min": "Full name must be at least 3 characters long",
  }),
  firstName: Joi.string().trim().min(3).optional().messages({
    "string.empty": "First name cannot be empty",
    "string.min": "First name must be at least 3 characters long",
  }),
  middleName: Joi.string().trim().min(3).optional().messages({
    "string.empty": "Middle name cannot be empty",
    "string.min": "Middle name must be at least 3 characters long",
  }),
  lastName: Joi.string().trim().min(3).optional().messages({
    "string.empty": "Last name cannot be empty",
    "string.min": "Last name must be at least 3 characters long",
  }),
  dob: Joi.date().optional().messages({
    "date.empty": "Date of birth/Registration Date can't be empty",
  }),
  gender: Joi.string()
    .trim()
    .valid(...Object.values(GENDERS))
    .optional()
    .messages({
      "any.only": `Gender must be one of ${Object.values(GENDERS).join(", ")}`,
    }),
  aadhaarNumber: Joi.string()
    .trim()
    .pattern(/^\d{4}\s?\d{4}\s?\d{4}$/)
    .optional()
    .messages({
      "string.pattern.base": "Please enter a valid Aadhaar number",
    }),
  isAadhaarLinked: Joi.boolean().optional(),
  addressDetails: Joi.object({
    buildingName: Joi.string().optional(),
    locality: Joi.string().optional(),
    streetName: Joi.string().optional(),
    pincode: Joi.string().optional(),
    city: Joi.string().optional(),
    state: Joi.string().optional(),
    country: Joi.string().optional(),
  }).optional(),
  chargeable: Joi.boolean().optional(),
  userConsent: Joi.boolean().optional(),
  verificationResponse: Joi.object().required().messages({
    "any.required": "Verification response date is required",
  }),
  verificationStatus: Joi.string()
    .trim()
    .valid(...Object.values(PRIMARY_VERIFICATION_STATUSES))
    .optional()
    .messages({
      "any.only": `Verification status must be one of ${Object.values(PRIMARY_VERIFICATION_STATUSES).join(", ")}`,
    }),
  verificationMessage: Joi.string()
    .trim()
    .when("verificationStatus", {
      is: Joi.valid(
        PRIMARY_VERIFICATION_STATUSES.FAILED,
        PRIMARY_VERIFICATION_STATUSES.REJECTED,
      ),
      then: Joi.string().required().messages({
        "any.required":
          "Verification message is required when verification status is FAILED or REJECTED",
        "string.empty": "Verification message cannot be empty",
      }),
      otherwise: Joi.string().optional().messages({
        "string.empty": "Verification message cannot be empty",
      }),
    }),
  providerTransactionId: Joi.string().trim().required().messages({
    "string.empty": "Provider transaction ID cannot be empty",
    "any.required": "Provider transaction ID is required",
  }),
  providerRequestId: Joi.string().trim().required().messages({
    "string.empty": "Provider request ID cannot be empty",
    "any.required": "Provider request ID is required",
  }),
  verificationProvider: Joi.string()
    .trim()
    .valid(...Object.values(PRIMARY_VERIFICATION_PROVIDERS))
    .default(PRIMARY_VERIFICATION_PROVIDERS.CGPEY)
    .messages({
      "string.empty": "Verification provider cannot be empty",
      "any.required": "Verification provider is required",
      "any.only": `Verification provider must be one of ${Object.values(PRIMARY_VERIFICATION_PROVIDERS).join(", ")}`,
    }),
  verifiedAt: Joi.date()
    .optional()
    .when("verificationStatus", {
      is: PRIMARY_VERIFICATION_STATUSES.SUCCESS,
      then: Joi.date().required().messages({
        "any.required":
          "Verified at date is required when verification status is SUCCESS",
        "date.empty":
          "Verified at date is required when verification status is SUCCESS",
      }),
      otherwise: Joi.date().optional(),
    }),
  isVerified: Joi.boolean().required().messages({
    "any.required": "Is verified is required",
    "boolean.empty": "Is verified can't be empty",
  }),
  currentScreen: Joi.string()
    .trim()
    .valid(...Object.values(SCREENS))
    .optional()
    .default(SCREENS.GST_VERIFICATION),
});
