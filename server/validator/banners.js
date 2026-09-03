const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const {
  BANNER_TYPE,
  BANNER_REDIRECT_TYPE,
  BANNER_SORT_BY,
} = require("../constants/banner");

const redirectObjectSchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(BANNER_REDIRECT_TYPE))
    .default(BANNER_REDIRECT_TYPE.NONE),
  targetId: objectId()
    .allow(null)
    .when("type", {
      is: Joi.valid(
        BANNER_REDIRECT_TYPE.CATEGORY,
        BANNER_REDIRECT_TYPE.DEAL,
        BANNER_REDIRECT_TYPE.BRAND,
        BANNER_REDIRECT_TYPE.OFFER,
      ),
      then: Joi.required().messages({
        "any.required": "Target ID is required for this redirect type.",
      }),
      otherwise: Joi.optional(),
    }),
  url: Joi.string()
    .trim()
    .uri()
    .allow(null)
    .when("type", {
      is: BANNER_REDIRECT_TYPE.EXTERNAL_URL,
      then: Joi.required().messages({
        "any.required": "URL is required for EXTERNAL_URL redirect type.",
      }),
      otherwise: Joi.optional(),
    }),
});

const jsonTolerantObject = (objectSchema, { label = "Field" } = {}) =>
  Joi.any().custom((value, helpers) => {
    if (value === undefined || value === null || value === "") return undefined;
    let parsed = value;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch (error) {
        return helpers.message({ custom: `${label} must be valid JSON.` });
      }
    }
    const { error, value: validated } = objectSchema.validate(parsed, {
      abortEarly: false,
      convert: true,
    });
    if (error) {
      const messages = error.details.map((detail) => detail.message).join(", ");
      return helpers.message({ custom: `${label}: ${messages}` });
    }
    return validated;
  });

const withDateRangeCheck = (schema) =>
  schema.custom((value, helpers) => {
    if (
      value.startDate &&
      value.endDate &&
      new Date(value.endDate) <= new Date(value.startDate)
    ) {
      return helpers.message({ custom: "End date must be after start date." });
    }
    return value;
  });

exports.validateCreateBanner = {
  body: withDateRangeCheck(
    Joi.object({
      title: Joi.string().trim().min(2).max(150).required().messages({
        "any.required": "Title is required.",
        "string.empty": "Title is required.",
      }),
      description: Joi.string().trim().max(1000).allow("").optional(),
      type: Joi.string()
        .valid(...Object.values(BANNER_TYPE))
        .required()
        .messages({
          "any.required": "Banner type is required.",
          "any.only": `Type must be one of: ${Object.values(BANNER_TYPE).join(", ")}.`,
        }),
      redirect: jsonTolerantObject(redirectObjectSchema, {
        label: "Redirect",
      }).optional(),
      startDate: Joi.date().iso().optional().allow(null),
      endDate: Joi.date().iso().optional().allow(null),
      isActive: Joi.boolean().optional().default(true),
    }),
  ),
};

exports.validateUpdateBanner = {
  params: {
    id: objectId().required().messages({
      "any.required": "Banner ID is required.",
      "any.invalid": "Invalid banner ID.",
    }),
  },
  body: withDateRangeCheck(
    Joi.object({
      title: Joi.string().trim().min(2).max(150).optional(),
      description: Joi.string().trim().max(1000).allow("").optional(),
      type: Joi.string()
        .valid(...Object.values(BANNER_TYPE))
        .optional(),
      redirect: jsonTolerantObject(redirectObjectSchema, {
        label: "Redirect",
      }).optional(),
      startDate: Joi.date().iso().optional().allow(null),
      endDate: Joi.date().iso().optional().allow(null),
      isActive: Joi.boolean().optional(),
    })
      .min(1)
      .messages({
        "object.min": "Please provide at least one field to update.",
      }),
  ),
};

exports.validateGetBanner = {
  params: {
    id: objectId().required().messages({
      "any.required": "Banner ID is required.",
      "any.invalid": "Invalid banner ID.",
    }),
  },
};

exports.validateGetAllBanners = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    search: Joi.string().trim().allow("").optional(),
    type: Joi.string()
      .valid(...Object.values(BANNER_TYPE))
      .optional(),
    isActive: Joi.boolean().optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    sortBy: Joi.string()
      .valid(...Object.values(BANNER_SORT_BY))
      .default(BANNER_SORT_BY.CREATED_AT),
    sortOrder: Joi.string().valid("asc", "desc").default("desc"),
  }),
};

exports.validateDeleteBanner = {
  params: {
    id: objectId().required().messages({
      "any.required": "Banner ID is required.",
      "any.invalid": "Invalid banner ID.",
    }),
  },
};
