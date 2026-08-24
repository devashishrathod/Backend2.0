const Joi = require("joi");

const voucherSettingSchema = Joi.object({
  maxOffers: Joi.number().integer().min(1).max(100).optional(),
  maxImages: Joi.number().integer().min(1).optional(),
  maxDistanceKm: Joi.number().integer().min(1).optional(),
});

const showcaseSettingSchema = Joi.object({
  maxSections: Joi.number().integer().min(1).optional(),
  maxItemsPerSection: Joi.number().integer().min(1).optional(),
  maxImagesPerSection: Joi.number().integer().min(1).optional(),
  maxVideosPerSection: Joi.number().integer().min(1).optional(),
  maxImageSizeMB: Joi.number().integer().min(1).optional(),
  maxVideoSizeMB: Joi.number().integer().min(1).optional(),
  allowedImages: Joi.array().items(Joi.string().trim()).min(1).optional(),
  allowedVideos: Joi.array().items(Joi.string().trim()).min(1).optional(),
  isActive: Joi.boolean().optional(),
});

// Everything the subscription / checkout flow reads at runtime. Merged onto the
// existing block, so an admin can change just the GST rate without resetting
// the seller identity and every policy flag.
const subscriptionSettingSchema = Joi.object({
  gstPercentage: Joi.number().min(0).max(100).optional().messages({
    "number.min": "gstPercentage must be at least {#limit}",
    "number.max": "gstPercentage cannot exceed {#limit}",
  }),
  isGstInclusive: Joi.boolean().optional(),
  hsnSacCode: Joi.string().trim().max(20).optional(),
  companyName: Joi.string().trim().max(160).optional(),
  companyGstin: Joi.string().trim().uppercase().allow("").max(15).optional(),
  companyAddress: Joi.string().trim().allow("").max(500).optional(),
  // Compared against the first two digits of the brand's GSTIN to decide
  // CGST+SGST vs IGST. Leave blank and every supply is treated as inter-state.
  companyStateCode: Joi.string()
    .trim()
    .allow("")
    .pattern(/^\d{2}$/)
    .optional()
    .messages({
      "string.pattern.base": "companyStateCode must be a 2-digit GST state code",
    }),
  companyState: Joi.string().trim().allow("").max(80).optional(),
  currency: Joi.string().trim().valid("INR").optional(),
  allowVendorUpgrade: Joi.boolean().optional(),
  allowVendorDowngrade: Joi.boolean().optional(),
  allowVendorRenewal: Joi.boolean().optional(),
  allowAdminDowngrade: Joi.boolean().optional(),
  allowAdminFreeGrant: Joi.boolean().optional(),
  gracePeriodDays: Joi.number().integer().min(0).max(90).optional(),
  pendingOrderReuseMinutes: Joi.number().integer().min(0).max(1440).optional(),
  expiryJobIntervalMinutes: Joi.number().integer().min(1).max(1440).optional(),
  isPromoCodeEnabled: Joi.boolean().optional(),
  // Day offsets before endDate on which a renewal reminder is sent.
  expiryReminderDays: Joi.array()
    .items(Joi.number().integer().min(1).max(365))
    .min(1)
    .max(6)
    .optional()
    .messages({
      "array.min": "Provide at least one reminder offset",
      "array.max": "At most {#limit} reminder offsets are supported",
    }),
  reminderJobIntervalMinutes: Joi.number().integer().min(1).max(1440).optional(),
  // Each outbound channel has its own kill switch. The in-app row is always
  // written regardless — these only govern delivery.
  isEmailNotificationEnabled: Joi.boolean().optional(),
  isPushNotificationEnabled: Joi.boolean().optional(),
  // Defaults to false. Turn on once the Meta-approved templates are set in the
  // WHATSAPP_TEMPLATE_* env vars — without both, nothing sends on WhatsApp.
  isWhatsAppNotificationEnabled: Joi.boolean().optional(),
  isActive: Joi.boolean().optional(),
});

exports.validateUpdateSetting = {
  body: Joi.object({
    vendor: Joi.object({
      voucher: voucherSettingSchema.optional(),
      showcase: showcaseSettingSchema.optional(),
      subscription: subscriptionSettingSchema.optional(),
    }).optional(),
    isActive: Joi.boolean().optional(),
  })
    .min(1)
    .messages({
      "object.min": "Please provide at least one field to update.",
    }),
};
