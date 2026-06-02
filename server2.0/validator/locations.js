const Joi = require("joi");
const objectId = require("./validJoiObjectId");

exports.validateCreateLocation = (data) => {
  const schema = Joi.object({
    userId: objectId().optional().messages({
      "any.invalid": "Invalid userId format",
    }),
    name: Joi.string().min(2).max(100).optional(),
    shopOrBuildingNumber: Joi.string().allow("").optional(),
    area: Joi.string().allow("").optional(),
    address: Joi.string().allow(""),
    city: Joi.string().allow(""),
    district: Joi.string().allow(""),
    state: Joi.string().allow(""),
    zipcode: Joi.string(),
    country: Joi.string().min(2).max(80).optional(),
    coordinates: Joi.array()
      .items(Joi.number())
      .length(2)
      .messages({
        "array.length": "Coordinates must be [longitude, latitude]",
      })
      .optional(),
  }).when(Joi.object({ coordinates: Joi.exist() }).unknown(), {
    then: Joi.object({
      address: Joi.string().optional(),
      city: Joi.string().optional(),
      district: Joi.string().optional(),
      state: Joi.string().optional(),
      zipcode: Joi.string().optional(),
    }),
    otherwise: Joi.object({
      address: Joi.string().required().messages({
        "any.required": "Address is required when coordinates are not provided",
      }),
      city: Joi.string().required().messages({
        "any.required": "City is required when coordinates are not provided",
      }),
      district: Joi.string().required().messages({
        "any.required":
          "District is required when coordinates are not provided",
      }),
      state: Joi.string().required().messages({
        "any.required": "State is required when coordinates are not provided",
      }),
      zipcode: Joi.string().required().messages({
        "any.required":
          "Zip Code/Postal Code is required when coordinates are not provided",
      }),
    }),
  });
  return schema.validate(data, { abortEarly: false });
};

exports.validateGetAllLocationsQuery = (payload) => {
  const getAllQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).optional(),
    search: Joi.string().optional(),
    name: Joi.string().optional(),
    shopOrBuildingNumber: Joi.string().optional(),
    userId: objectId().optional().messages({
      "any.invalid": "Invalid userId format",
    }),
    address: Joi.string().optional(),
    area: Joi.string().optional(),
    city: Joi.string().optional(),
    district: Joi.string().optional(),
    state: Joi.string().optional(),
    zipcode: Joi.string().optional(),
    country: Joi.string().optional(),
    isActive: Joi.alternatives().try(Joi.string(), Joi.boolean()).optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    sortBy: Joi.string().optional(),
    sortOrder: Joi.string().valid("asc", "desc").optional(),
  });
  return getAllQuerySchema.validate(payload, { abortEarly: false });
};
