const Joi = require("joi");
const {
  SETTLEMENT_CYCLE_TYPES,
  PAYOUT_PROVIDERS,
  REFUND_METHODS,
  VENDOR_TIMEOUT_ACTIONS,
} = require("../constants/customer");
const { GATEWAY_FEE_BEARER } = require("../constants/transaction");

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

// ---------------------------------------------------------------------------
// Customer side
//
// Every block is merged onto the stored one, never replaced, so an admin can
// PATCH a single fee slab without resetting nine other blocks to their defaults.
//
// ⚠️ Joi only checks shape here. The rule that spans two blocks —
// `settlement.delayDays * 24 >= refund.windowHours + vendorApprovalHours +
// adminBufferHours` — cannot live in a request validator, because a PATCH that
// touches only one of them carries no copy of the other. It runs on the merged
// document in `services/settings/updateSetting.js`.
// ---------------------------------------------------------------------------

const convenienceFeeSchema = Joi.object({
  isEnabled: Joi.boolean().optional(),
  slabSize: Joi.number().integer().min(1).optional().messages({
    "number.min": "slabSize must be at least {#limit}",
  }),
  feePerSlab: Joi.number().min(0).optional(),
  // `null` is a deliberate value meaning "no ceiling" — distinct from omitting
  // the field, which leaves whatever is stored alone.
  maxFee: Joi.number().min(0).allow(null).optional(),
  chargeWhenNoOffer: Joi.boolean().optional(),
});

const customerTaxSchema = Joi.object({
  isGstEnabled: Joi.boolean().optional(),
  gstPercentage: Joi.number().min(0).max(100).optional().messages({
    "number.max": "gstPercentage cannot exceed {#limit}",
  }),
  isGstInclusive: Joi.boolean().optional(),
  sacCode: Joi.string().trim().allow("").max(20).optional(),
});

const customerPromoSchema = Joi.object({
  isEnabled: Joi.boolean().optional(),
  allowWhenNoOffer: Joi.boolean().optional(),
  allowForGuestPreview: Joi.boolean().optional(),
});

const claimSettingSchema = Joi.object({
  isEnabled: Joi.boolean().optional(),
  allowWhenNoOffer: Joi.boolean().optional(),
  maxBillAmount: Joi.number().integer().min(1).max(10000000).optional(),
  pendingOrderReuseMinutes: Joi.number().integer().min(0).max(1440).optional(),
  quoteTtlMinutes: Joi.number().integer().min(1).max(1440).optional(),
  allowWhenVendorPlanExpired: Joi.boolean().optional(),
  vendorPlanExpiredGraceDays: Joi.number().integer().min(0).max(90).optional(),
  redemptionWindowHours: Joi.number().integer().min(1).max(8760).optional(),
});

const customerNotificationSchema = Joi.object({
  isEmailNotificationEnabled: Joi.boolean().optional(),
  isPushNotificationEnabled: Joi.boolean().optional(),
  // Defaults to false. Turn on once the Meta-approved templates are set in the
  // WHATSAPP_TEMPLATE_* env vars — without both, nothing sends on WhatsApp.
  isWhatsAppNotificationEnabled: Joi.boolean().optional(),
});

const customerInvoiceSchema = Joi.object({
  // ⚠️ Changing this starts a NEW counter. Numbers already issued keep the old
  // prefix, which is correct — an invoice number is a permanent legal reference.
  seriesPrefix: Joi.string()
    .trim()
    .uppercase()
    .min(2)
    .max(6)
    .pattern(/^[A-Z]+$/)
    .optional()
    .messages({
      "string.pattern.base": "seriesPrefix may only contain letters",
      "string.max": "seriesPrefix cannot exceed {#limit} characters",
    }),
});

const settlementSettingSchema = Joi.object({
  isEnabled: Joi.boolean().optional(),
  // Capped at 30 because a longer hold is a working-capital decision, not a
  // setting — and the refund windows have to fit inside it.
  delayDays: Joi.number().integer().min(0).max(30).optional(),
  payoutBufferHours: Joi.number().integer().min(0).max(168).optional(),
  cycleType: Joi.string()
    .uppercase()
    .valid(...Object.values(SETTLEMENT_CYCLE_TYPES))
    .optional()
    .messages({
      "any.only": `cycleType must be one of: ${Object.values(SETTLEMENT_CYCLE_TYPES).join(", ")}`,
    }),
  requiresAdminApproval: Joi.boolean().optional(),
  minPayoutAmount: Joi.number().min(0).optional(),
  payoutProvider: Joi.string()
    .uppercase()
    .valid(...Object.values(PAYOUT_PROVIDERS))
    .optional()
    .messages({
      "any.only": `payoutProvider must be one of: ${Object.values(PAYOUT_PROVIDERS).join(", ")}`,
    }),
  commissionPercent: Joi.number().min(0).max(100).optional(),
  reserve: Joi.object({
    isEnabled: Joi.boolean().optional(),
    percent: Joi.number().min(0).max(100).optional(),
    holdDays: Joi.number().integer().min(0).max(365).optional(),
    riskChargebackCount: Joi.number().integer().min(1).optional(),
  }).optional(),
  newVendorReserveDays: Joi.number().integer().min(0).max(365).optional(),
  notReceivedAlertHours: Joi.number().integer().min(1).max(720).optional(),
  gatewayFeeBearer: Joi.string()
    .uppercase()
    .valid(...Object.values(GATEWAY_FEE_BEARER))
    .optional()
    .messages({
      "any.only": `gatewayFeeBearer must be one of: ${Object.values(GATEWAY_FEE_BEARER).join(", ")}`,
    }),
});

const refundSettingSchema = Joi.object({
  method: Joi.string()
    .uppercase()
    .valid(...Object.values(REFUND_METHODS))
    .optional()
    .messages({
      "any.only": `method must be one of: ${Object.values(REFUND_METHODS).join(", ")}`,
    }),
  windowHours: Joi.number().integer().min(0).max(720).optional(),
  vendorApprovalHours: Joi.number().integer().min(0).max(720).optional(),
  adminBufferHours: Joi.number().integer().min(0).max(720).optional(),
  onVendorTimeout: Joi.string()
    .uppercase()
    .valid(...Object.values(VENDOR_TIMEOUT_ACTIONS))
    .optional()
    .messages({
      "any.only": `onVendorTimeout must be one of: ${Object.values(VENDOR_TIMEOUT_ACTIONS).join(", ")}`,
    }),
  allowPartial: Joi.boolean().optional(),
  releasePromoOnRefund: Joi.boolean().optional(),
  authorizedAlertMinutes: Joi.number().integer().min(1).max(1440).optional(),
});

const chargebackSettingSchema = Joi.object({
  writeOffDays: Joi.number().integer().min(1).max(365).optional(),
});

const customerSettingSchema = Joi.object({
  convenienceFee: convenienceFeeSchema.optional(),
  tax: customerTaxSchema.optional(),
  promoCode: customerPromoSchema.optional(),
  claim: claimSettingSchema.optional(),
  notification: customerNotificationSchema.optional(),
  invoice: customerInvoiceSchema.optional(),
  settlement: settlementSettingSchema.optional(),
  refund: refundSettingSchema.optional(),
  chargeback: chargebackSettingSchema.optional(),
});

exports.validateUpdateSetting = {
  body: Joi.object({
    vendor: Joi.object({
      voucher: voucherSettingSchema.optional(),
      showcase: showcaseSettingSchema.optional(),
      subscription: subscriptionSettingSchema.optional(),
    }).optional(),
    customer: customerSettingSchema.optional(),
    isActive: Joi.boolean().optional(),
  })
    .min(1)
    .messages({
      "object.min": "Please provide at least one field to update.",
    }),
};
