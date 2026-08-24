const Joi = require("joi");
const {
  DEVICE_PLATFORMS,
  NOTIFICATION_DEFAULTS,
} = require("../constants/notification");

const platforms = Object.values(DEVICE_PLATFORMS);

exports.validateRegisterDeviceToken = {
  body: Joi.object({
    // FCM registration tokens are long (~150+ chars) and the ceiling is generous
    // rather than tight: the provider has changed their length before, and a
    // rejected valid token means a device that silently never gets notified.
    token: Joi.string().trim().min(20).max(4096).required().messages({
      "string.empty": "token is required",
      "string.min": "token does not look like a valid push token",
      "any.required": "token is required",
    }),
    platform: Joi.string()
      .uppercase()
      .valid(...platforms)
      .required()
      .messages({
        "any.only": `platform must be one of: ${platforms.join(", ")}`,
        "any.required": "platform is required",
      }),
    // Optional, but worth sending: it lets a reinstall replace its own stale
    // token instead of leaving a dead row behind.
    deviceId: Joi.string().trim().max(128).optional(),
    deviceName: Joi.string().trim().max(128).optional(),
    appVersion: Joi.string().trim().max(32).optional(),
  }),
};

exports.validateUnregisterDeviceToken = {
  body: Joi.object({
    token: Joi.string().trim().min(20).max(4096).optional(),
    // "Sign out everywhere."
    allDevices: Joi.boolean().default(false),
  })
    .or("token", "allDevices")
    .messages({
      "object.missing": "Provide a token, or set allDevices to true.",
    }),
};

exports.validateGetMyDevices = {
  query: Joi.object({
    // Retired devices are hidden by default; useful when diagnosing why push
    // stopped arriving.
    includeInactive: Joi.alternatives()
      .try(Joi.boolean(), Joi.string().valid("true", "false"))
      .optional(),
  }),
};

exports.validateSendTestPush = {
  body: Joi.object({
    title: Joi.string()
      .trim()
      .max(NOTIFICATION_DEFAULTS.maxTitleLength)
      .optional(),
    body: Joi.string().trim().max(NOTIFICATION_DEFAULTS.maxBodyLength).optional(),
  }),
};
