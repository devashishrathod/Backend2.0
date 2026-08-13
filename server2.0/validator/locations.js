const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const { ADDRESS_TYPES } = require("../constants");
const { isValidZipCode } = require("./common");

exports.validateCreateLocation = {
  body: Joi.object({
    userId: objectId().optional().messages({
      "any.invalid": "Invalid userId format",
    }),
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid brandId format",
    }),
    subBrandId: objectId().optional().messages({
      "any.invalid": "Invalid subBrandId format",
    }),
    addressLine1: Joi.string().required().messages({
      "any.required": "Address Line 1 is required",
    }),
    addressLine2: Joi.string().optional(),
    landmark: Joi.string().optional(),
    city: Joi.string().required().messages({
      "any.required": "City is required",
    }),
    district: Joi.string().optional(),
    state: Joi.string().required().messages({
      "any.required": "State is required",
    }),
    zipcode: Joi.string()
      .required()
      .custom((value, helpers) => {
        const country = helpers.state.ancestors[0].country;
        if (!isValidZipCode(country, value)) {
          return helpers.error("any.invalid");
        }
        return value;
      })
      .messages({
        "any.required": "Zip Code/Postal Code is required",
        "any.invalid": "Invalid Zip Code/Postal Code",
      }),
    country: Joi.string().min(2).max(80).default("india"),
    formattedAddress: Joi.string().min(1).max(500).optional(),
    coordinates: Joi.array()
      .items(Joi.number().required())
      .length(2)
      .custom((value, helpers) => {
        const [lng, lat] = value;
        if (lng < -180 || lng > 180) {
          return helpers.error("any.invalid", {
            message: "Longitude must be between -180 and 180.",
          });
        }
        if (lat < -90 || lat > 90) {
          return helpers.error("any.invalid", {
            message: "Latitude must be between -90 and 90.",
          });
        }
        return value;
      })
      .required()
      .messages({
        "array.base": "Coordinates must be an array.",
        "array.length": "Coordinates must be [longitude, latitude].",
        "array.includes": "Coordinates must contain only numbers.",
        "any.required": "Coordinates are required.",
        "any.invalid": "Invalid longitude/latitude.",
      }),
    addressType: Joi.string()
      .valid(...Object.values(ADDRESS_TYPES))
      .default(ADDRESS_TYPES.HOME),
    isBrandAddress: Joi.alternatives()
      .try(Joi.string(), Joi.boolean())
      .default(false),
    isSubBrandAddress: Joi.alternatives()
      .try(Joi.string(), Joi.boolean())
      .default(false),
    isDefault: Joi.alternatives()
      .try(Joi.string(), Joi.boolean())
      .default(false),
  }),
};

exports.validateGetAllLocationsQuery = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).optional(),
    search: Joi.string().optional(),
    userId: objectId().optional().messages({
      "any.invalid": "Invalid userId format",
    }),
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid brandId format",
    }),
    subBrandId: objectId().optional().messages({
      "any.invalid": "Invalid subBrandId format",
    }),
    // name: Joi.string().optional(),
    // shopOrBuildingNumber: Joi.string().optional(),
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
    isBrandAddress: Joi.alternatives()
      .try(Joi.string(), Joi.boolean())
      .optional(),
    isSubBrandAddress: Joi.alternatives()
      .try(Joi.string(), Joi.boolean())
      .optional(),
    isDefault: Joi.alternatives().try(Joi.string(), Joi.boolean()).optional(),
  }),
};

exports.validateGetLocation = {
  params: {
    id: objectId().required().messages({
      "any.required": "Location ID is required",
      "any.invalid": "Invalid location ID format",
    }),
  },
};

exports.validateUpdateLocation = {
  params: {
    id: objectId().required().messages({
      "any.required": "Location ID is required",
      "any.invalid": "Invalid location ID format",
    }),
  },
  body: Joi.object({
    addressLine1: Joi.string().optional(),
    addressLine2: Joi.string().optional(),
    landmark: Joi.string().optional(),
    city: Joi.string().optional(),
    district: Joi.string().optional(),
    state: Joi.string().optional(),
    zipcode: Joi.string()
      .optional()
      .custom((value, helpers) => {
        const country = helpers.state.ancestors[0].country;
        if (!isValidZipCode(country, value)) {
          return helpers.error("any.invalid");
        }
        return value;
      })
      .messages({
        "any.invalid": "Invalid Zip Code/Postal Code",
      }),
    country: Joi.string().min(2).max(80).optional(),
    formattedAddress: Joi.string().min(1).max(500).optional(),
    coordinates: Joi.array()
      .items(Joi.number().required())
      .length(2)
      .custom((value, helpers) => {
        const [lng, lat] = value;
        if (lng < -180 || lng > 180) {
          return helpers.error("any.invalid", {
            message: "Longitude must be between -180 and 180.",
          });
        }
        if (lat < -90 || lat > 90) {
          return helpers.error("any.invalid", {
            message: "Latitude must be between -90 and 90.",
          });
        }
        return value;
      })
      .optional()
      .messages({
        "array.base": "Coordinates must be an array.",
        "array.length": "Coordinates must be [longitude, latitude].",
        "array.includes": "Coordinates must contain only numbers.",
        "any.invalid": "Invalid longitude/latitude.",
      }),
    addressType: Joi.string()
      .valid(...Object.values(ADDRESS_TYPES))
      .optional(),
    isBrandAddress: Joi.alternatives()
      .try(Joi.string(), Joi.boolean())
      .optional(),
    isSubBrandAddress: Joi.alternatives()
      .try(Joi.string(), Joi.boolean())
      .optional(),
    isDefault: Joi.alternatives().try(Joi.string(), Joi.boolean()).optional(),
  }),
};
