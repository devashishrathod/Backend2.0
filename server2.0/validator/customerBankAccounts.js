const Joi = require("joi");
const objectId = require("./validJoiObjectId");

/**
 * Adding a bank account for refunds.
 *
 * ⚠️ Nothing about verification is accepted here — no `isVerified`, no
 * `verifiedAt`, no provider response. The service derives all of it from the
 * penny drop it performs itself, because a client that can assert
 * `isVerified: true` can point a refund at any account it likes.
 */
exports.validateAddBankAccount = {
  body: Joi.object({
    /**
     * 9–18 digits, the same range `isValidAccountNumber` enforces on the model.
     * Checked here as well so a typo comes back as a field error the app can put
     * next to the box, rather than as a Mongoose validation failure.
     */
    accountNumber: Joi.string()
      .trim()
      .pattern(/^\d{9,18}$/)
      .required()
      .messages({
        "any.required": "Please enter your account number.",
        "string.empty": "Please enter your account number.",
        "string.pattern.base": "That does not look like a valid account number.",
      }),
    ifscCode: Joi.string()
      .trim()
      .uppercase()
      .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
      .required()
      .messages({
        "any.required": "Please enter the IFSC code.",
        "string.empty": "Please enter the IFSC code.",
        "string.pattern.base": "That does not look like a valid IFSC code.",
      }),
    /**
     * Optional: the penny drop returns the name the bank holds, which is more
     * reliable than what someone types on a phone. Accepted so the app can
     * pre-fill it, and overridden by the bank's answer when one comes back.
     */
    accountHolderName: Joi.string().trim().min(2).max(120).optional(),
    otp: Joi.string()
      .trim()
      .pattern(/^\d{4,8}$/)
      .required()
      .messages({
        "any.required": "Please enter the code we sent you.",
        "string.empty": "Please enter the code we sent you.",
        "string.pattern.base": "That code does not look right.",
      }),
  }),
};

exports.validateDeleteBankAccount = {
  params: Joi.object({
    accountId: objectId().required().messages({
      "any.required": "accountId is required.",
      "any.invalid": "Invalid accountId.",
    }),
  }),
};
