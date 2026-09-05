const Joi = require("joi");

/**
 * Both optional, and both only affect the two computed booleans.
 *
 * ⚠️ Nothing here changes *what* is returned — the whitelist is fixed. A caller
 * that sends neither still gets the whole config, with `updateRequired` and
 * `updateAvailable` as `null` rather than a guess. That is the honest answer to
 * a question nobody asked, and it stops a client trusting a `false` it never
 * supplied the input for.
 */
exports.validateGetAppConfig = {
  query: Joi.object({
    platform: Joi.string().lowercase().valid("android", "ios").optional().messages({
      "any.only": "platform must be android or ios",
    }),
    /**
     * `major.minor.patch`. Shape-checked here so a typo comes back as a field
     * error rather than being parsed to `0.0.0` and silently demanding an
     * update from somebody already on the newest build.
     */
    version: Joi.string()
      .trim()
      .pattern(/^\d+(\.\d+){0,2}$/)
      .optional()
      .messages({
        "string.pattern.base": "version must look like 1.2.3",
      }),
  }),
};
