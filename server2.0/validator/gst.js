const Joi = require("joi");
const {
  PRIMARY_VERIFICATION_PROVIDERS,
  PRIMARY_VERIFICATION_STATUSES,
  GST_TAXPAYER_TYPE,
  GST_REGISTRATION_STATUS,
  SCREENS,
} = require("../constants");

exports.validateAddGstDetails = Joi.object({
  gstNumber: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
    .required()
    .messages({
      "string.empty": "GST number is required",
      "string.pattern.base": "Please enter a valid GSTIN",
      "any.required": "GST number is required",
    }),
  legalName: Joi.string().trim().min(3).max(100).required().messages({
    "string.empty": "Legal name is required",
    "any.required": "Legal name is required",
    "string.min": "Legal name must be at least 3 characters long",
    "string.max": "Legal name must be up to 100 characters",
  }),
  tradeName: Joi.string().trim().min(3).max(100).optional().messages({
    "string.empty": "Trade name is required",
    "string.min": "Trade name must be at least 3 characters long",
    "string.max": "Trade name must be up to 100 characters",
  }),
  constitutionOfBusiness: Joi.string().trim().required().messages({
    "any.required": "Constitution of business is required",
    "string.empty": "Constitution of business can't be empty",
  }),
  taxpayerType: Joi.string()
    .trim()
    .valid(...Object.values(GST_TAXPAYER_TYPE))
    .required()
    .messages({
      "string.empty": "GST taxpayerType cannot be empty",
      "any.required": "GST taxpayerType is required",
      "any.only": `GST taxpayerType must be one of ${Object.values(GST_TAXPAYER_TYPE).join(", ")}`,
    }),
  registrationDate: Joi.date().required().messages({
    "any.required": "Registration date is required",
    "string.empty": "Registration date can't be empty",
  }),
  registrationStatus: Joi.string()
    .trim()
    .valid(...Object.values(GST_REGISTRATION_STATUS))
    .required()
    .messages({
      "string.empty": "GST registration status cannot be empty",
      "any.required": "GST registration status is required",
      "any.only": `GST registration status must be one of ${Object.values(GST_REGISTRATION_STATUS).join(", ")}`,
    }),
  cancellationDate: Joi.date().optional().messages({
    "string.empty": "CancellationDate date can't be empty",
  }),
  filingStatus: Joi.string().trim().optional(),
  stateCode: Joi.string().trim().optional(),
  centerCode: Joi.string().trim().optional(),
  natureOfBusiness: Joi.array().optional(),
  stateJurisdiction: Joi.string().trim().optional(),
  stateJurisdictionCode: Joi.string().trim().optional(),
  address: Joi.object({
    floorNumber: Joi.string().trim().optional(),
    buildingNumber: Joi.string().trim().optional(),
    buildingName: Joi.string().trim().optional(),
    location: Joi.string().trim().required(),
    city: Joi.string().trim().required(),
    district: Joi.string().trim().required(),
    state: Joi.string().trim().required(),
    pin: Joi.string().trim().required(),
    country: Joi.string().trim().optional(),
    latitude: Joi.string().trim().optional(),
    longitude: Joi.string().trim().optional(),
    businessNature: Joi.string().trim().optional(),
  }).required(),
  lastUpdated: Joi.date().optional().messages({
    "string.empty": "lastUpdated date can't be empty",
  }),
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
    .default(SCREENS.BANK_VERIFICATION),
});
