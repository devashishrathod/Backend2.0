const Joi = require("joi");
const mongoose = require("mongoose");

const objectId = (value, helpers) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return helpers.message(`"${value}" is not a valid ObjectId`);
  }
  return value;
};

exports.validateCreatePromoCode = (promoCodeData) => {
  const createPromoCodeSchema = Joi.object({
    claimedUsers: Joi.array()
      .items(
        Joi.object({
          userId: Joi.string().custom(objectId).required().messages({
            "any.required": "User ID is required in claimedUsers",
            "string.base": "User ID must be a string",
            "string.empty": "User ID cannot be empty",
          }),
          claimedAt: Joi.date().optional().messages({
            "date.base": "ClaimedAt must be a valid date",
          }),
        })
      )
      .optional()
      .messages({
        "array.base": "ClaimedUsers must be an array",
      }),
    voucher: Joi.string().custom(objectId).required().messages({
      "any.required": "Voucher ID is required",
      "string.base": "Voucher ID must be a string",
      "string.empty": "Voucher ID cannot be empty",
    }),
    title: Joi.string().optional().allow("").messages({
      "string.base": "Title must be a string",
    }),
    description: Joi.string().optional().allow("").messages({
      "string.base": "Description must be a string",
    }),
    promoCode: Joi.string().min(3).trim().required().messages({
      "any.required": "Promo code is required",
      "string.base": "Promo code must be a string",
      "string.empty": "Promo code cannot be empty",
      "string.min": "Promo code must be at least 3 characters long",
    }),
    maxDiscountValue: Joi.number().positive().min(1).required().messages({
      "any.required": "Max discount is required",
      "number.base": "Max discount must be a number",
      "number.positive": "Max discount must be greater than 0",
      "number.min": "Max discount must be at least 1",
    }),
    userLimit: Joi.number().positive().required().messages({
      "any.required": "User limit is required",
      "number.base": "User limit must be a number",
      "number.positive": "User limit must be greater than 0",
    }),
    validFrom: Joi.date().optional().messages({
      "date.base": "Valid From must be a valid date",
    }),
    validTill: Joi.date().optional().messages({
      "date.base": "Valid Till must be a valid date",
    }),
  }).options({ abortEarly: false });

  return createPromoCodeSchema.validate(promoCodeData);
};
