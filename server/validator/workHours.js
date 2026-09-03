const Joi = require("joi");
const objectId = require("./validJoiObjectId");

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const daySchema = Joi.object({
  start: Joi.string()
    .pattern(TIME_REGEX)
    .when("isOpen", {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional().allow(null, ""),
    })
    .messages({
      "string.pattern.base": "Start time must be in HH:mm format",
      "any.required": "Start time is required when the day is open",
    }),
  end: Joi.string()
    .pattern(TIME_REGEX)
    .when("isOpen", {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional().allow(null, ""),
    })
    .messages({
      "string.pattern.base": "End time must be in HH:mm format",
      "any.required": "End time is required when the day is open",
    }),
  isOpen: Joi.boolean().default(false),
})
  .custom((value, helpers) => {
    if (!value.isOpen) return value;
    if (!value.start || !value.end) return value;

    const startMinutes =
      Number(value.start.split(":")[0]) * 60 +
      Number(value.start.split(":")[1]);

    const endMinutes =
      Number(value.end.split(":")[0]) * 60 + Number(value.end.split(":")[1]);

    if (startMinutes >= endMinutes) {
      return helpers.error("any.invalid");
    }
    return value;
  })
  .messages({
    "any.invalid": "Start time must be earlier than end time",
  });

exports.validateUpsertWorkHours = {
  body: Joi.object({
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid brandId format",
    }),
    subBrandId: objectId().optional().messages({
      "any.invalid": "Invalid subBrandId format",
    }),
    monday: daySchema.optional(),
    tuesday: daySchema.optional(),
    wednesday: daySchema.optional(),
    thursday: daySchema.optional(),
    friday: daySchema.optional(),
    saturday: daySchema.optional(),
    sunday: daySchema.optional(),
  })
    .custom((value, helpers) => {
      if (!value.brandId && !value.subBrandId) {
        return helpers.error("any.custom", {
          message: "Either brandId or subBrandId is required",
        });
      }
      if (value.brandId && value.subBrandId) {
        return helpers.error("any.custom", {
          message: "Provide either brandId or subBrandId, not both",
        });
      }
      const days = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ];
      const hasDay = days.some((day) => value[day] !== undefined);
      if (!hasDay) {
        return helpers.error("any.custom", {
          message: "At least one working day is required",
        });
      }
      return value;
    })
    .messages({
      "any.custom": "{{#message}}",
    }),
};
