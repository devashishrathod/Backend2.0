const Joi = require("joi");
const {
  BANK_ACCOUNT_TYPES,
  PRIMARY_VERIFICATION_PROVIDERS,
  PRIMARY_VERIFICATION_STATUSES,
  SCREENS,
} = require("../constants");

exports.validateAddBankDetails = Joi.object({
  isValid: Joi.boolean().required(),
  recommendedAction: Joi.string().trim().required(),
  accountHolderName: Joi.string().trim().min(3).max(100).required().messages({
    "any.required": "Account holder name is required",
    "string.empty": "Account holder name can't be empty",
    "string.min": "Account holder name has minimum {#limit} characters",
    "string.max": "Account holder name cannot exceed {#limit} characters",
  }),
  accountNumber: Joi.string()
    .trim()
    .pattern(/^\d{9,18}$/)
    .required()
    .messages({
      "any.required": "Account number is required",
      "string.empty": "Account number can't be empty",
      "string.pattern.base": "Please enter a valid account number!",
    }),
  ifscCode: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
    .required()
    .messages({
      "any.required": "IFSC code is required",
      "string.empty": "IFSC code can't be empty",
      "string.pattern.base": "Please enter a valid IFSC code",
    }),
  bankName: Joi.string().trim().optional(),
  branchName: Joi.string().trim().optional(),
  bankAddress: Joi.object().optional(),
  retrievalReferenceNumber: Joi.string().trim().optional(),
  user: Joi.object().optional(),
  accountType: Joi.string()
    .trim()
    .valid(...Object.values(BANK_ACCOUNT_TYPES))
    .optional()
    .messages({
      "any.only": `Bank account type must be one of ${Object.values(BANK_ACCOUNT_TYPES).join(", ")}`,
    }),
  isNameMatch: Joi.boolean().optional(),
  matchingScore: Joi.string().trim().optional(),
  paymentMode: Joi.string().trim().optional(),
  failureReason: Joi.string().trim().optional(),
  npciErrorCode: Joi.string().trim().optional(),
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
    .default(SCREENS.SYSTEM_VERIFICATION),
});
