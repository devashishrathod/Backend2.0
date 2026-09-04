const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const {
  SEARCH_RESULT_TYPES,
  SEARCH_LIMITS,
} = require("../constants/search");

/**
 * The global customer search box.
 *
 * ⚠️ `minQueryLength` is **not** enforced here. It is admin-configurable
 * (`Setting.customer.search`), and Joi schemas are built once at require time —
 * baking the value in would freeze whatever it was at boot and quietly ignore
 * every later change. Joi holds the floor at 1 so an empty string never reaches
 * a regex; the service applies the configured minimum.
 */
exports.validateGlobalSearch = {
  query: Joi.object({
    q: Joi.string()
      .trim()
      .min(1)
      .max(SEARCH_LIMITS.MAX_QUERY_LENGTH)
      .required()
      .messages({
        "any.required": "Search text is required.",
        "string.empty": "Search text is required.",
        "string.max": `Search text cannot exceed ${SEARCH_LIMITS.MAX_QUERY_LENGTH} characters.`,
      }),

    /**
     * Overview mode filter — which sections to build. Absent means all of them.
     * Comma-separated so the app can send one param.
     */
    types: Joi.string()
      .trim()
      .custom((value, helpers) => {
        const parsed = value
          .split(",")
          .map((part) => part.trim().toUpperCase())
          .filter(Boolean);
        if (!parsed.length) return helpers.error("any.invalid");
        const allowed = Object.values(SEARCH_RESULT_TYPES);
        if (parsed.some((type) => !allowed.includes(type))) {
          return helpers.error("any.invalid");
        }
        return [...new Set(parsed)];
      })
      .optional()
      .messages({
        "any.invalid": `types must be a comma-separated list of: ${Object.values(
          SEARCH_RESULT_TYPES,
        ).join(", ")}`,
      }),

    /**
     * Single-type mode. Present means "one section, paginated" and the response
     * shape changes — see `globalSearch`.
     */
    type: Joi.string()
      .trim()
      .uppercase()
      .valid(...Object.values(SEARCH_RESULT_TYPES))
      .optional(),

    page: Joi.number().integer().min(1).default(1),

    /**
     * No `.default()`. Overview and single-type mode have different sensible
     * page sizes, and the overview default is admin-configurable — so an
     * unspecified limit has to reach the service as `undefined` for it to
     * choose. A default here would silently win over the setting.
     */
    limit: Joi.number()
      .integer()
      .min(1)
      .max(SEARCH_LIMITS.MAX_TYPE_LIMIT)
      .optional(),

    latitude: Joi.number().min(-90).max(90).optional(),
    longitude: Joi.number().min(-180).max(180).optional(),

    // The app sends this when the customer presses Search or opens a result —
    // never on the calls it fires while they are still typing.
    commit: Joi.alternatives()
      .try(Joi.boolean(), Joi.string().valid("true", "false"))
      .optional(),
  })
    .and("latitude", "longitude")
    /**
     * `page` without `type` is refused rather than ignored. The overview has
     * five sections and no single page number to apply — silently dropping it
     * costs an app developer an afternoon wondering why page 2 returns page 1.
     */
    .custom((value, helpers) => {
      if (value.type && value.types) return helpers.error("search.bothTypes");
      if (!value.type && value.page && value.page > 1) {
        return helpers.error("search.pageWithoutType");
      }
      return value;
    })
    .messages({
      "object.and": "latitude and longitude must be provided together.",
      "search.bothTypes":
        "Send either `type` (one section, paginated) or `types` (which sections to include) — not both.",
      "search.pageWithoutType":
        "`page` only applies with `type`. The overview returns every section's first rows.",
    }),
};

exports.validateGetSearchHistory = {
  query: Joi.object({
    limit: Joi.number().integer().min(1).max(100).optional(),
  }),
};

exports.validateDeleteSearchHistoryEntry = {
  params: Joi.object({
    historyId: objectId().required().messages({
      "any.required": "History id is required.",
      "any.invalid": "Invalid history id.",
    }),
  }),
};
