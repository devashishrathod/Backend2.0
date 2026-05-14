const Joi = require("joi");
const mongoose = require("mongoose");

const objectId = (value, helpers) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return helpers.error("any.invalid");
  }
  return value;
};

exports.createBillValidation = (data) => {
  const billSchema = Joi.object({
    billAmount: Joi.number().min(1).required(),
    voucherId: Joi.custom(objectId).required(),
    currency: Joi.string().valid("INR").optional(),
    subBrandId: Joi.custom(objectId).required(),
    offer: Joi.object({
      offerType: Joi.string().valid("PromoCode", "LessAmount").required(),
      offerId: Joi.custom(objectId).required(),
    }).optional(),
  }).options({ abortEarly: false });
  return billSchema.validate(data);
};
