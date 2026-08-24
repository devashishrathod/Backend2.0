const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const { ROLES } = require("../constants");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
  NOTIFICATION_DEFAULTS,
  AUDIENCE_LIMITS,
} = require("../constants/notification");

const roles = Object.values(ROLES);

/**
 * The audience for a broadcast.
 *
 * Deliberately one shape for every way of addressing people, so a role added to
 * the platform later needs no new field here. Targets **union** together, and at
 * least one must be present — a broadcast with no audience is a mistake, not an
 * empty send.
 *
 * `all: true` has to be spelled out explicitly. Nobody should reach every user
 * on the platform by leaving a field off.
 */
const audienceTarget = Joi.object({
  userIds: Joi.array()
    .items(objectId())
    .max(AUDIENCE_LIMITS.MAX_RECIPIENTS_PER_DISPATCH)
    .optional()
    .messages({
      "any.invalid": "Invalid userId in the audience",
      "array.max": `You cannot name more than ${AUDIENCE_LIMITS.MAX_RECIPIENTS_PER_DISPATCH} users in one send`,
    }),
  roles: Joi.array()
    .items(Joi.string().uppercase().valid(...roles))
    .optional()
    .messages({
      "any.only": `roles must contain only: ${roles.join(", ")}`,
    }),
  brandIds: Joi.array().items(objectId()).optional().messages({
    "any.invalid": "Invalid brandId in the audience",
  }),
  customerIds: Joi.array().items(objectId()).optional().messages({
    "any.invalid": "Invalid customerId in the audience",
  }),
  subBrandIds: Joi.array().items(objectId()).optional().messages({
    "any.invalid": "Invalid subBrandId in the audience",
  }),
  all: Joi.boolean().optional(),
  filters: Joi.object({
    hasEmail: Joi.boolean().optional(),
  }).optional(),
})
  .or("userIds", "roles", "brandIds", "customerIds", "subBrandIds", "all")
  .messages({
    "object.missing":
      "An audience is required: pass userIds, roles, brandIds, customerIds, subBrandIds, or all.",
  });

exports.validateGetAllNotifications = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    // Optional for a vendor (their own brand); an admin omitting it reads the
    // admin-audience feed instead.
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid brandId",
    }),
    type: Joi.string()
      .valid(...Object.values(NOTIFICATION_TYPES))
      .optional()
      .messages({
        "any.only": `type must be one of: ${Object.values(NOTIFICATION_TYPES).join(", ")}`,
      }),
    isRead: Joi.alternatives()
      .try(Joi.boolean(), Joi.string().valid("true", "false"))
      .optional(),
  }),
};

exports.validateMarkNotificationsRead = {
  body: Joi.object({
    notificationIds: Joi.array().items(objectId()).min(1).optional().messages({
      "array.min": "Provide at least one notificationId",
      "any.invalid": "Invalid notificationId",
    }),
    markAll: Joi.boolean().default(false),
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid brandId",
    }),
  })
    // One or the other must be present, never neither.
    .or("notificationIds", "markAll")
    .messages({
      "object.missing": "Provide notificationIds or set markAll to true.",
    }),
};

exports.validateBroadcastNotification = {
  body: Joi.object({
    title: Joi.string()
      .trim()
      .max(NOTIFICATION_DEFAULTS.maxTitleLength)
      .required()
      .messages({
        "string.empty": "title is required",
        "string.max": `title cannot exceed ${NOTIFICATION_DEFAULTS.maxTitleLength} characters`,
        "any.required": "title is required",
      }),
    body: Joi.string()
      .trim()
      .max(NOTIFICATION_DEFAULTS.maxBodyLength)
      .required()
      .messages({
        "string.empty": "body is required",
        "string.max": `body cannot exceed ${NOTIFICATION_DEFAULTS.maxBodyLength} characters`,
        "any.required": "body is required",
      }),
    target: audienceTarget.required().messages({
      "any.required": "target is required",
    }),
    severity: Joi.string()
      .uppercase()
      .valid(...Object.values(NOTIFICATION_SEVERITY))
      .optional()
      .messages({
        "any.only": `severity must be one of: ${Object.values(NOTIFICATION_SEVERITY).join(", ")}`,
      }),
    // Defaults to ANNOUNCEMENT. Overridable so an admin can send a message that
    // the client already knows how to render and deep-link.
    type: Joi.string()
      .valid(...Object.values(NOTIFICATION_TYPES))
      .optional()
      .messages({
        "any.only": `type must be one of: ${Object.values(NOTIFICATION_TYPES).join(", ")}`,
      }),
    push: Joi.boolean().default(true),
    // Client route to open when the notification is tapped.
    deepLink: Joi.string().trim().max(512).optional(),
    imageUrl: Joi.string().trim().uri().max(1024).optional().messages({
      "string.uri": "imageUrl must be a valid URL",
    }),
    meta: Joi.object().optional(),
    // Resolve the audience and report its size without sending anything. Worth
    // running before any wide broadcast.
    dryRun: Joi.boolean().default(false),
    // Supplying the id of a previous broadcast retries it: recipients who
    // already received it are skipped, so only the ones missed get notified.
    broadcastId: objectId().optional().messages({
      "any.invalid": "Invalid broadcastId",
    }),
  }),
};
