const Joi = require("joi");

exports.validateUpdateUser = (data) => {
  const schema = Joi.object({
    name: Joi.string().min(2).max(100).messages({
      "string.min": "Name should have at least {#limit} characters",
      "string.max": "Name should not exceed {#limit} characters",
    }),
    address: Joi.string().allow("").max(300).messages({
      "string.max": "Address cannot exceed {#limit} characters",
    }),
    dob: Joi.date().iso().messages({
      "date.format":
        "Date of birth must be a valid date in ISO format (YYYY-MM-DD)",
    }),
    email: Joi.string().email().messages({
      "string.email": "Please enter a valid email address",
    }),
    mobile: Joi.number().integer().min(1000000000).max(9999999999).messages({
      "number.base": "Mobile number must be numeric",
      "number.min": "Mobile number must be 10 digits",
      "number.max": "Mobile number must be 10 digits",
    }),
  });
  return schema.validate(data, { abortEarly: false });
};
