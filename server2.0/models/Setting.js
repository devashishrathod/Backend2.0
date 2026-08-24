const mongoose = require("mongoose");
const { SUBSCRIPTION_DEFAULTS } = require("../constants/subscription");

const voucherSettingSchema = new mongoose.Schema(
  {
    maxOffers: {
      type: Number,
      default: 10,
      min: 1,
      max: 100,
    },
    maxImages: {
      type: Number,
      default: 5,
      min: 1,
    },
    maxDistanceKm: {
      type: Number,
      default: 25,
      min: 1,
    },
  },
  { _id: false },
);

const showcaseSettingSchema = new mongoose.Schema(
  {
    maxSections: {
      type: Number,
      required: true,
      default: 5,
      min: 1,
    },
    maxItemsPerSection: {
      type: Number,
      required: true,
      default: 15,
      min: 1,
    },
    maxImagesPerSection: {
      type: Number,
      required: true,
      default: 15,
      min: 1,
    },
    maxVideosPerSection: {
      type: Number,
      required: true,
      default: 5,
      min: 1,
    },
    maxImageSizeMB: {
      type: Number,
      required: true,
      default: 10,
      min: 1,
    },
    maxVideoSizeMB: {
      type: Number,
      required: true,
      default: 50,
      min: 1,
    },
    allowedImages: {
      type: [String],
      default: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
    },
    allowedVideos: {
      type: [String],
      default: ["video/mp4", "video/webm", "video/quicktime"],
    },
    isActive: { type: Boolean, default: true },
  },
  { _id: false },
);

/**
 * Everything the subscription / checkout flow is allowed to vary by admin.
 * Read only through `helpers/settings/getSubscriptionConfig.js`, which falls
 * back to `constants/subscription.js` when a value is missing here.
 */
const subscriptionSettingSchema = new mongoose.Schema(
  {
    // ---------- tax ----------
    gstPercentage: {
      type: Number,
      default: SUBSCRIPTION_DEFAULTS.gstPercentage,
      min: 0,
      max: 100,
    },
    // false => GST is charged on top of the plan price (the usual case).
    // true  => the plan price already contains GST and is back-calculated.
    isGstInclusive: {
      type: Boolean,
      default: SUBSCRIPTION_DEFAULTS.isGstInclusive,
    },
    hsnSacCode: { type: String, default: SUBSCRIPTION_DEFAULTS.hsnSacCode },

    // ---------- seller identity (invoice header + place-of-supply) ----------
    companyName: { type: String, default: SUBSCRIPTION_DEFAULTS.companyName },
    companyGstin: { type: String, default: SUBSCRIPTION_DEFAULTS.companyGstin },
    companyAddress: {
      type: String,
      default: SUBSCRIPTION_DEFAULTS.companyAddress,
    },
    // Compared against the first two digits of the brand's GSTIN to decide
    // CGST+SGST vs IGST. Blank => we cannot prove intra-state, so IGST.
    companyStateCode: {
      type: String,
      default: SUBSCRIPTION_DEFAULTS.companyStateCode,
    },
    // Used only when the brand has no GSTIN and we have to fall back to
    // comparing the brand's location state by name.
    companyState: { type: String, default: SUBSCRIPTION_DEFAULTS.companyState },
    currency: { type: String, default: SUBSCRIPTION_DEFAULTS.currency },

    // ---------- who may do what ----------
    allowVendorUpgrade: {
      type: Boolean,
      default: SUBSCRIPTION_DEFAULTS.allowVendorUpgrade,
    },
    allowVendorDowngrade: {
      type: Boolean,
      default: SUBSCRIPTION_DEFAULTS.allowVendorDowngrade,
    },
    allowVendorRenewal: {
      type: Boolean,
      default: SUBSCRIPTION_DEFAULTS.allowVendorRenewal,
    },
    allowAdminDowngrade: {
      type: Boolean,
      default: SUBSCRIPTION_DEFAULTS.allowAdminDowngrade,
    },
    allowAdminFreeGrant: {
      type: Boolean,
      default: SUBSCRIPTION_DEFAULTS.allowAdminFreeGrant,
    },

    // ---------- lifecycle ----------
    gracePeriodDays: {
      type: Number,
      default: SUBSCRIPTION_DEFAULTS.gracePeriodDays,
      min: 0,
    },
    pendingOrderReuseMinutes: {
      type: Number,
      default: SUBSCRIPTION_DEFAULTS.pendingOrderReuseMinutes,
      min: 0,
    },
    expiryJobIntervalMinutes: {
      type: Number,
      default: SUBSCRIPTION_DEFAULTS.expiryJobIntervalMinutes,
      min: 1,
    },

    // ---------- promo codes ----------
    // Master switch. While false, passing a promoCode returns 422 rather than
    // silently charging full price.
    isPromoCodeEnabled: {
      type: Boolean,
      default: SUBSCRIPTION_DEFAULTS.isPromoCodeEnabled,
    },

    // ---------- renewal reminders ----------
    // Days before endDate on which to remind, e.g. [7, 3, 1].
    expiryReminderDays: {
      type: [Number],
      default: () => [...SUBSCRIPTION_DEFAULTS.expiryReminderDays],
    },
    reminderJobIntervalMinutes: {
      type: Number,
      default: SUBSCRIPTION_DEFAULTS.reminderJobIntervalMinutes,
      min: 1,
    },
    // Each channel can be silenced independently. The in-app row is always
    // written regardless — these only govern outbound delivery.
    isEmailNotificationEnabled: {
      type: Boolean,
      default: SUBSCRIPTION_DEFAULTS.isEmailNotificationEnabled,
    },
    isPushNotificationEnabled: {
      type: Boolean,
      default: SUBSCRIPTION_DEFAULTS.isPushNotificationEnabled,
    },
    // Off until the Meta-approved templates exist. Even when on, a type with no
    // approved template still does not send.
    isWhatsAppNotificationEnabled: {
      type: Boolean,
      default: SUBSCRIPTION_DEFAULTS.isWhatsAppNotificationEnabled,
    },

    isActive: { type: Boolean, default: true },
  },
  { _id: false },
);

const vendorSettingSchema = new mongoose.Schema(
  {
    voucher: {
      type: voucherSettingSchema,
      default: () => ({}),
    },
    showcase: {
      type: showcaseSettingSchema,
      default: () => ({}),
    },
    subscription: {
      type: subscriptionSettingSchema,
      default: () => ({}),
    },
  },
  { _id: false },
);

const customerSettingSchema = new mongoose.Schema(
  {
    // Future customer settings
  },
  { _id: false },
);

const settingSchema = new mongoose.Schema(
  {
    vendor: {
      type: vendorSettingSchema,
      default: () => ({}),
    },
    customer: {
      type: customerSettingSchema,
      default: () => ({}),
    },
    isActive: { type: Boolean, default: true },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model("Setting", settingSchema);
