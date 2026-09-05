const Joi = require("joi");
const {
  SETTLEMENT_CYCLE_TYPES,
  PAYOUT_PROVIDERS,
  REFUND_METHODS,
  VENDOR_TIMEOUT_ACTIONS,
} = require("../constants/customer");
const { GATEWAY_FEE_BEARER } = require("../constants/transaction");
const { SEARCH_LIMITS } = require("../constants/search");

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

/**
 * The admin audience's outbound channels.
 *
 * ⚠️ Its own block, not a corner of `vendor` or `customer`, because the whole
 * point is that the three cannot silence each other. `getNotificationConfig`
 * used to fall through to the vendor block for admin, so switching off vendor
 * renewal reminders also switched off `SETTLEMENT_LEDGER_DRIFT`, `REFUND_FAILED`
 * and every other alert that fires when money has gone wrong.
 *
 * ⚠️ This is a **kill switch for an outage**, not a preference. An admin who
 * personally wants fewer emails has `PUT /notifications/preferences`, which
 * quiets them without quieting the rest of the team.
 */
const adminNotificationSchema = Joi.object({
  isEmailNotificationEnabled: Joi.boolean().optional(),
  isPushNotificationEnabled: Joi.boolean().optional(),
  // Defaults to false, like the other two audiences: WhatsApp needs a
  // Meta-approved template per message type before anything sends.
  isWhatsAppNotificationEnabled: Joi.boolean().optional(),
});

const adminSettingSchema = Joi.object({
  notification: adminNotificationSchema.optional(),
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

  /**
   * ⚠️ These three were on the model and in `getCustomerConfig` but **not here**,
   * and `stripUnknown` is on — so an admin setting them got a `200` and nothing
   * changed. `refund_flow.md` §2.3 documents them as admin config, which was
   * true of everything except the one step that would have let anyone set them.
   *
   * The allowance rules: how many refunds a customer may have open at once, how
   * many rejections before they are pointed at support, and the window those are
   * counted over.
   */
  maxOpenRequests: Joi.number().integer().min(1).max(50).optional(),
  maxRejectedPerWindow: Joi.number().integer().min(1).max(100).optional(),
  requestWindowDays: Joi.number().integer().min(1).max(365).optional(),

  /**
   * `MANUAL_BANK`: when a customer is nudged for their account details, and
   * after how long a silent one becomes an admin's problem.
   *
   * ⚠️ `bankDetailsReminderHours` is sorted ascending by the job rather than
   * trusted in order — saved as `[96, 24]` the stages would otherwise fire
   * backwards. `min(1)` on the array, because an empty one is not "no reminders",
   * it is a job that quietly nudges nobody.
   */
  bankDetailsReminderHours: Joi.array()
    .items(Joi.number().integer().min(1).max(720))
    .min(1)
    .max(5)
    .optional()
    .messages({
      "array.min": "At least one reminder, or nobody is ever chased.",
    }),
  bankDetailsStaleDays: Joi.number().integer().min(1).max(365).optional(),
});

const chargebackSettingSchema = Joi.object({
  writeOffDays: Joi.number().integer().min(1).max(365).optional(),
  /**
   * Hours before a dispute deadline at which an admin is warned. Widest first,
   * though `disputeDeadlines` sorts them itself.
   *
   * ⚠️ `min(1)` on the array for the same reason as above: a dispute deadline
   * that passes is an **automatic loss**, and an empty list means no warning at
   * all — with nothing to show that anything is switched off.
   */
  deadlineAlertHours: Joi.array()
    .items(Joi.number().integer().min(1).max(720))
    .min(1)
    .max(5)
    .optional()
    .messages({
      "array.min": "At least one warning, or a deadline can pass unseen.",
    }),
});

const searchSettingSchema = Joi.object({
  isEnabled: Joi.boolean().optional(),
  /**
   * ⚠️ Floor of 1. Zero would let an empty query reach a match that runs over
   * brands, vouchers, categories and every outlet address at once — and return
   * essentially the whole platform to somebody who typed nothing.
   */
  minQueryLength: Joi.number().integer().min(1).max(10).optional().messages({
    "number.min": "A search needs at least one character to match on.",
  }),
  sectionLimit: Joi.number()
    .integer()
    .min(1)
    .max(SEARCH_LIMITS.MAX_SECTION_LIMIT)
    .optional(),
  historyLimit: Joi.number().integer().min(1).max(100).optional(),
  /**
   * Curated chips for the empty search box.
   *
   * ⚠️ No `.min(1)` — unlike the alert arrays above, an empty list here is a
   * legitimate choice and simply means no chips are shown. Nothing silently
   * stops working.
   */
  popularQueries: Joi.array()
    .items(
      Joi.string().trim().min(1).max(SEARCH_LIMITS.MAX_POPULAR_QUERY_LENGTH),
    )
    .max(SEARCH_LIMITS.MAX_POPULAR_QUERIES)
    .optional(),
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
  search: searchSettingSchema.optional(),
});

/**
 * One-time codes. Neither audience's — vendors, sub-vendors and customers all
 * log in through the same machinery.
 *
 * ⚠️ `maxPerHour` has a floor of 1. Zero would lock **everybody** out of logging
 * in, from a settings screen, and the way back in is also a login.
 *
 * ⚠️ `resendCooldownSeconds` allows 0 on purpose — "no wait" is a real choice,
 * and `getSecurityConfig` reads it with `??` so it survives rather than being
 * quietly restored to the default.
 */
const otpSettingSchema = Joi.object({
  resendCooldownSeconds: Joi.number().integer().min(0).max(3600).optional(),
  maxPerHour: Joi.number().integer().min(1).max(100).optional().messages({
    "number.min": "At least one code an hour, or nobody can sign in.",
  }),
});

const securitySettingSchema = Joi.object({
  otp: otpSettingSchema.optional(),
});

/**
 * The public block — everything here is readable by anyone at `GET /app-config`.
 *
 * ⚠️ Validate it **more** strictly than the private blocks, not less. A typo in
 * `minVersion` does not fail here and does not fail on save; it fails on every
 * customer's phone at launch, and the fix needs the very update the typo is
 * demanding. So the version shape is enforced rather than trusted.
 */
const appVersionSchema = Joi.object({
  android: Joi.string()
    .trim()
    .pattern(/^\d+(\.\d+){0,2}$/)
    .optional()
    .messages({ "string.pattern.base": "android version must look like 1.2.3" }),
  ios: Joi.string()
    .trim()
    .pattern(/^\d+(\.\d+){0,2}$/)
    .optional()
    .messages({ "string.pattern.base": "ios version must look like 1.2.3" }),
});

const appSettingSchema = Joi.object({
  minVersion: appVersionSchema.optional(),
  latestVersion: appVersionSchema.optional(),
  /**
   * ⚠️ This locks every user out of every build below `minVersion`, at once.
   * There is no staged rollout and no undo other than setting it back — so it is
   * its own field rather than something inferred from a version bump.
   */
  forceUpdate: Joi.boolean().optional(),
  updateMessage: Joi.string().trim().max(300).optional(),
  storeUrl: Joi.object({
    android: Joi.string().trim().uri().allow("").optional(),
    ios: Joi.string().trim().uri().allow("").optional(),
  }).optional(),
  /**
   * Where every "please contact support" sentence in the app points. Blank is
   * allowed — it is the honest state before somebody fills it in, and refusing
   * blank would mean the block could never be partially configured.
   */
  support: Joi.object({
    email: Joi.string().trim().lowercase().email().allow("").optional(),
    phone: Joi.string().trim().allow("").optional(),
    whatsapp: Joi.string().trim().allow("").optional(),
  }).optional(),
  /**
   * ⚠️ These hide screens in the app. They do **not** close endpoints — the
   * server keeps enforcing on its own, so turning `promoCodes` off here still
   * leaves `create-order` returning its hard 422 rather than silently accepting.
   */
  features: Joi.object({
    promoCodes: Joi.boolean().optional(),
    refunds: Joi.boolean().optional(),
    voucherClaims: Joi.boolean().optional(),
    search: Joi.boolean().optional(),
  }).optional(),
});

exports.validateUpdateSetting = {
  body: Joi.object({
    vendor: Joi.object({
      voucher: voucherSettingSchema.optional(),
      showcase: showcaseSettingSchema.optional(),
      subscription: subscriptionSettingSchema.optional(),
    }).optional(),
    customer: customerSettingSchema.optional(),
    security: securitySettingSchema.optional(),
    /**
     * ⚠️ Without this entry the block was unreachable. `stripUnknown` is on, so
     * an `admin` key in the body was silently removed — no error, a 200, and a
     * toggle that never moved. The model had the field and `getAdminConfig()`
     * read it; nothing could write it.
     */
    admin: adminSettingSchema.optional(),
    app: appSettingSchema.optional(),
    isActive: Joi.boolean().optional(),
  })
    .min(1)
    .messages({
      "object.min": "Please provide at least one field to update.",
    }),
};
