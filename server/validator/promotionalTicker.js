const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const {
  TICKER_REDIRECT_TYPE,
  TICKER_SORT_BY,
} = require("../constants/promotionalTicker");

const redirectObjectSchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(TICKER_REDIRECT_TYPE))
    .default(TICKER_REDIRECT_TYPE.NONE),
  targetId: objectId()
    .allow(null)
    .when("type", {
      is: Joi.valid(
        TICKER_REDIRECT_TYPE.CATEGORY,
        TICKER_REDIRECT_TYPE.DEAL,
        TICKER_REDIRECT_TYPE.BRAND,
        TICKER_REDIRECT_TYPE.OFFER,
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
      is: TICKER_REDIRECT_TYPE.EXTERNAL_URL,
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

exports.validateCreateTicker = {
  body: withDateRangeCheck(
    Joi.object({
      title: Joi.string().trim().min(2).max(100).required().messages({
        "any.required": "Title is required.",
        "string.empty": "Title is required.",
      }),
      redirect: jsonTolerantObject(redirectObjectSchema, {
        label: "Redirect",
      }).optional(),
      displayOrder: Joi.number().integer().min(0).optional().default(0),
      startDate: Joi.date().iso().optional().allow(null),
      endDate: Joi.date().iso().optional().allow(null),
      isActive: Joi.boolean().optional().default(true),
    }),
  ),
};

exports.validateUpdateTicker = {
  params: {
    id: objectId().required().messages({
      "any.required": "Ticker ID is required.",
      "any.invalid": "Invalid ticker ID.",
    }),
  },
  body: withDateRangeCheck(
    Joi.object({
      title: Joi.string().trim().min(2).max(100).optional(),
      redirect: jsonTolerantObject(redirectObjectSchema, {
        label: "Redirect",
      }).optional(),
      displayOrder: Joi.number().integer().min(0).optional(),
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

exports.validateGetTicker = {
  params: {
    id: objectId().required().messages({
      "any.required": "Ticker ID is required.",
      "any.invalid": "Invalid ticker ID.",
    }),
  },
};

exports.validateGetAllTickers = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    search: Joi.string().trim().allow("").optional(),
    isActive: Joi.boolean().optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    sortBy: Joi.string()
      .valid(...Object.values(TICKER_SORT_BY))
      .default(TICKER_SORT_BY.DISPLAY_ORDER),
    sortOrder: Joi.string().valid("asc", "desc").default("asc"),
  }),
};

exports.validateDeleteTicker = {
  params: {
    id: objectId().required().messages({
      "any.required": "Ticker ID is required.",
      "any.invalid": "Invalid ticker ID.",
    }),
  },
};
