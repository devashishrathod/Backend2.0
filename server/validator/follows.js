const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const { FOLLOW_SORT_BY } = require("../constants/follow");

exports.validateToggleFollow = {
  params: {
    brandId: objectId().required().messages({
      "any.required": "Brand ID is required.",
      "any.invalid": "Invalid brand ID.",
    }),
  },
};

exports.validateGetAllFollowedBrands = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    search: Joi.string().trim().allow("").optional(),
    sortBy: Joi.string()
      .valid(...Object.values(FOLLOW_SORT_BY))
      .default(FOLLOW_SORT_BY.CREATED_AT),
    sortOrder: Joi.string().valid("asc", "desc").default("desc"),
  }),
};
