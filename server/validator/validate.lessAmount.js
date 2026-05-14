const Joi = require("joi");
const mongoose = require("mongoose");
const { OFFERS_SCOPE } = require("../constants");

const objectIdValidation = (value, helpers) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return helpers.message("{{#label}} must be a valid MongoDB ObjectId");
  }
  return value;
};

exports.validateCreateLessAmount = (lessAmountData) => {
  const createLessAmountSchema = Joi.object({
    voucher: Joi.string().custom(objectIdValidation).required().messages({
      "any.required": "Voucher ID is required",
    }),
    scope: Joi.string()
      .valid(...Object.values(OFFERS_SCOPE))
      .required()
      .messages({
        "any.only": "Scope must be either ALL_USERS or SELECTED_USERS",
        "any.required": "Scope is required",
      }),
    users: Joi.when("scope", {
      is: "SELECTED_USERS",
      then: Joi.array()
        .items(
          Joi.string().custom(objectIdValidation).messages({
            "string.base": "Each userId must be a string",
            "any.custom": "Each userId must be a valid MongoDB ObjectId",
          }),
        )
        .min(1)
        .required()
        .messages({
          "array.base": "Users must be an array of user IDs",
          "array.min":
            "At least one user ID must be provided when scope is SELECTED_USERS",
          "any.required":
            "Users field is required when scope is SELECTED_USERS",
        }),
      otherwise: Joi.forbidden(),
    }),
    title: Joi.string().min(3).max(100).required().messages({
      "string.min": "Title must be at least {#limit} characters",
      "string.max": "Title must be at most {#limit} characters",
      "any.required": "Title is required",
    }),
    description: Joi.string().allow("").max(500).messages({
      "string.max": "Description cannot exceed {#limit} characters",
    }),
    maxDiscountValue: Joi.number().positive().required().messages({
      "number.base": "Max discount must be a number",
      "number.positive": "Max discount must be greater than zero",
      "any.required": "Max discount is required",
    }),
    validFrom: Joi.date().required().messages({
      "date.base": "Valid from must be a valid date",
      "any.required": "Valid from date is required",
    }),
    validTill: Joi.date().required().messages({
      "date.base": "Valid till must be a valid date",
      "any.required": "Valid till date is required",
    }),
  })
    .options({ abortEarly: false })
    .custom((value, helpers) => {
      const now = new Date();
      if (value.validTill < value.validFrom) {
        return helpers.message(
          "Valid till date must be greater than or equal to valid from date",
        );
      }
      return value;
    });
  return createLessAmountSchema.validate(lessAmountData);
};

exports.validateGetAllLessAmountQuery = (query) => {
  const schema = Joi.object({
    page: Joi.number().min(1).default(1),
    limit: Joi.number().min(1).max(100).default(10),
    search: Joi.string().allow(""),
    voucher: Joi.string(),
    scope: Joi.string().valid(...Object.values(OFFERS_SCOPE)),
    isActive: Joi.boolean(),
    validFrom: Joi.date(),
    validTill: Joi.date(),
    sortBy: Joi.string().default("createdAt"),
    sortOrder: Joi.string().valid("asc", "desc").default("desc"),
  }).options({ abortEarly: false });
  return schema.validate(query);
};
