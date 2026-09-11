const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const phone = require("./validJoiPhone");

/**
 * An admin changing somebody else's contact details.
 *
 * ⚠️ `reason` is **required**, and that is the point of the endpoint as much as
 * the write is. This is the one path that can move a `whatsappNumber` — the login
 * identity — without an OTP, and an unexplained change to how an account signs in
 * is exactly what an audit trail exists to make impossible.
 *
 * At least one of the three keys must be sent; sending none would be a write that
 * changes nothing while still logging as an admin contact change.
 */
exports.validateAdminUpdateContact = {
  params: Joi.object({
    userId: objectId().required().messages({
      "any.required": "User ID is required",
      "any.invalid": "Invalid User ID format",
    }),
  }),
  body: Joi.object({
    email: Joi.string().trim().lowercase().email().optional().messages({
      "string.email": "Please enter a valid email address",
    }),
    mobile: phone("mobile number").optional(),
    whatsappNumber: phone("WhatsApp number").optional(),
    reason: Joi.string().trim().min(5).max(300).required().messages({
      "string.empty": "A reason is required",
      "string.min": "Please give a reason of at least {#limit} characters",
      "string.max": "Reason cannot exceed {#limit} characters",
      "any.required": "A reason is required",
    }),
  })
    .or("email", "mobile", "whatsappNumber")
    .messages({
      "object.missing":
        "Send at least one of email, mobile or whatsappNumber to change.",
    }),
};

exports.validateUpdateUser = (data) => {
  const schema = Joi.object({
    fullName: Joi.string().min(2).max(100).messages({
      "string.min": "Name should have at least {#limit} characters",
      "string.max": "Name should not exceed {#limit} characters",
    }),
    // address: Joi.string().allow("").max(300).messages({
    //   "string.max": "Address cannot exceed {#limit} characters",
    // }),
    dob: Joi.date().iso().messages({
      "date.format":
        "Date of birth must be a valid date in ISO format (YYYY-MM-DD)",
    }),
    email: Joi.string().email().messages({
      "string.email": "Please enter a valid email address",
    }),
    appliedReferralCode: Joi.string().optional().allow("").max(20).messages({
      "string.max": "Applied referral code cannot exceed {#limit} characters",
    }),
    // mobile: Joi.number().integer().min(1000000000).max(9999999999).messages({
    //   "number.base": "Mobile number must be numeric",
    //   "number.min": "Mobile number must be 10 digits",
    //   "number.max": "Mobile number must be 10 digits",
    // }),
  });
  return schema.validate(data, { abortEarly: false });
};
