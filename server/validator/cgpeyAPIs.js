const Joi = require("joi");

exports.validateVerifyPan = Joi.object({
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
});

exports.validateVerifyGst = Joi.object({
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
});

exports.validateVerifyBank = Joi.object({
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
  beneficiaryName: Joi.string().trim().min(3).max(100).optional().messages({
    "string.empty": "Beneficiary name can't be empty",
    "string.min": "Beneficiary name has minimum {#limit} characters",
    "string.max": "Beneficiary name cannot exceed {#limit} characters",
  }),
});
