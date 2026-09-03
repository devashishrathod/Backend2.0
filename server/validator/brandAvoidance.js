const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const { BRAND_AVOIDANCE_SORT_BY } = require("../constants/brandAvoidance");

exports.validateToggleBrandAvoidance = {
  params: {
    brandId: objectId().required().messages({
      "any.required": "Brand ID is required.",
      "any.invalid": "Invalid brand ID.",
    }),
  },
};

exports.validateGetAllBrandAvoidances = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    search: Joi.string().trim().allow("").optional(),
    sortBy: Joi.string()
      .valid(...Object.values(BRAND_AVOIDANCE_SORT_BY))
      .default(BRAND_AVOIDANCE_SORT_BY.CREATED_AT),
    sortOrder: Joi.string().valid("asc", "desc").default("desc"),
  }),
};
