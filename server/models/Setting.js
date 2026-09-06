const mongoose = require("mongoose");
const { SUBSCRIPTION_DEFAULTS } = require("../constants/subscription");
const { OTP_DEFAULTS } = require("../constants/otp");
const { APP_CONFIG_DEFAULTS } = require("../constants/app");
const {
  CONVENIENCE_FEE_DEFAULTS,
  CUSTOMER_TAX_DEFAULTS,
  CUSTOMER_PROMO_DEFAULTS,
  CLAIM_DEFAULTS,
  CUSTOMER_NOTIFICATION_DEFAULTS,
  CUSTOMER_INVOICE_DEFAULTS,
  SETTLEMENT_DEFAULTS,
  REFUND_DEFAULTS,
  CHARGEBACK_DEFAULTS,
  SETTLEMENT_CYCLE_TYPES,
  PAYOUT_PROVIDERS,
  REFUND_METHODS,
  VENDOR_TIMEOUT_ACTIONS,
  CUSTOMER_SEARCH_DEFAULTS,
} = require("../constants/customer");
const { SEARCH_LIMITS } = require("../constants/search");
const { GATEWAY_FEE_BEARER } = require("../constants/transaction");
const {
  ADMIN_NOTIFICATION_DEFAULTS,
} = require("../constants/notification");

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

/**
 * The platform fee a customer pays on top of a discounted bill.
 *
 * Charged in slabs rather than as a percentage: every `slabSize` rupees of the
 * bill costs `feePerSlab`, so a 600 bill sits in the second slab and pays 10.
 * Kept configurable because the slab is a commercial decision, not a technical
 * one — an admin changes it through `PUT /settings/update`, not a deploy.
 */
const convenienceFeeSchema = new mongoose.Schema(
  {
    isEnabled: { type: Boolean, default: CONVENIENCE_FEE_DEFAULTS.isEnabled },
    slabSize: { type: Number, default: CONVENIENCE_FEE_DEFAULTS.slabSize, min: 1 },
    feePerSlab: { type: Number, default: CONVENIENCE_FEE_DEFAULTS.feePerSlab, min: 0 },
    // `null` means no ceiling and is still accepted — but it is no longer the
    // default, because reaching it by never touching the setting put a ₹100 fee
    // on a ₹10,000 bill.
    maxFee: { type: Number, default: CONVENIENCE_FEE_DEFAULTS.maxFee, min: 0 },
    chargeWhenNoOffer: {
      type: Boolean,
      default: CONVENIENCE_FEE_DEFAULTS.chargeWhenNoOffer,
    },
  },
  { _id: false },
);

/** GST on the convenience fee — Trydood's own service income, not the vendor's. */
const customerTaxSchema = new mongoose.Schema(
  {
    isGstEnabled: { type: Boolean, default: CUSTOMER_TAX_DEFAULTS.isGstEnabled },
    gstPercentage: {
      type: Number,
      default: CUSTOMER_TAX_DEFAULTS.gstPercentage,
      min: 0,
      max: 100,
    },
    // true => the slab amounts already contain the tax and it is back-calculated,
    // so turning the master switch on does not silently raise what is charged.
    isGstInclusive: {
      type: Boolean,
      default: CUSTOMER_TAX_DEFAULTS.isGstInclusive,
    },
    sacCode: { type: String, default: CUSTOMER_TAX_DEFAULTS.sacCode },
  },
  { _id: false },
);

/** Customer-side promo codes. Separate switch from the vendor one. */
const customerPromoSchema = new mongoose.Schema(
  {
    isEnabled: { type: Boolean, default: CUSTOMER_PROMO_DEFAULTS.isEnabled },
    allowWhenNoOffer: {
      type: Boolean,
      default: CUSTOMER_PROMO_DEFAULTS.allowWhenNoOffer,
    },
    allowForGuestPreview: {
      type: Boolean,
      default: CUSTOMER_PROMO_DEFAULTS.allowForGuestPreview,
    },
  },
  { _id: false },
);

/** The claim flow itself — kill switch, limits and windows. */
const claimSettingSchema = new mongoose.Schema(
  {
    isEnabled: { type: Boolean, default: CLAIM_DEFAULTS.isEnabled },
    allowWhenNoOffer: { type: Boolean, default: CLAIM_DEFAULTS.allowWhenNoOffer },
    maxBillAmount: { type: Number, default: CLAIM_DEFAULTS.maxBillAmount, min: 1 },
    pendingOrderReuseMinutes: {
      type: Number,
      default: CLAIM_DEFAULTS.pendingOrderReuseMinutes,
      min: 0,
    },
    quoteTtlMinutes: {
      type: Number,
      default: CLAIM_DEFAULTS.quoteTtlMinutes,
      min: 1,
    },
    allowWhenVendorPlanExpired: {
      type: Boolean,
      default: CLAIM_DEFAULTS.allowWhenVendorPlanExpired,
    },
    vendorPlanExpiredGraceDays: {
      type: Number,
      default: CLAIM_DEFAULTS.vendorPlanExpiredGraceDays,
      min: 0,
    },
    redemptionWindowHours: {
      type: Number,
      default: CLAIM_DEFAULTS.redemptionWindowHours,
      min: 1,
    },
  },
  { _id: false },
);

/**
 * Customer outbound channels.
 *
 * Deliberately not shared with `vendor.subscription.is*NotificationEnabled` —
 * silencing vendor renewal reminders must not also silence a customer's payment
 * receipt.
 */
const customerNotificationSchema = new mongoose.Schema(
  {
    isEmailNotificationEnabled: {
      type: Boolean,
      default: CUSTOMER_NOTIFICATION_DEFAULTS.isEmailNotificationEnabled,
    },
    isPushNotificationEnabled: {
      type: Boolean,
      default: CUSTOMER_NOTIFICATION_DEFAULTS.isPushNotificationEnabled,
    },
    isWhatsAppNotificationEnabled: {
      type: Boolean,
      default: CUSTOMER_NOTIFICATION_DEFAULTS.isWhatsAppNotificationEnabled,
    },
  },
  { _id: false },
);

/**
 * Admin outbound channels.
 *
 * ### ⚠️ Why this block had to exist
 *
 * `getNotificationConfig(audience)` returned `getSubscriptionConfig()` — the
 * **vendor** block — for anything that was not a customer. So the admin feed's
 * email was governed by the vendor's toggle: switching off vendor renewal
 * reminders also switched off `SETTLEMENT_LEDGER_DRIFT`, `REFUND_FAILED` and
 * every other alert whose whole job is to reach a person when money has gone
 * wrong. Nothing said so, and the admin who flipped it had no reason to think
 * they had touched their own alerts.
 *
 * Three audiences, three blocks, no sharing — the same reasoning the customer
 * block above is written against.
 *
 * ⚠️ Defaults are **on** and should stay on. This is a kill switch for an
 * outage, not a preference; an admin who wants fewer emails has their own
 * `User.notificationPreferences`, which silences them alone rather than the
 * whole team.
 */
const adminNotificationSchema = new mongoose.Schema(
  {
    isEmailNotificationEnabled: {
      type: Boolean,
      default: ADMIN_NOTIFICATION_DEFAULTS.isEmailNotificationEnabled,
    },
    isPushNotificationEnabled: {
      type: Boolean,
      default: ADMIN_NOTIFICATION_DEFAULTS.isPushNotificationEnabled,
    },
    isWhatsAppNotificationEnabled: {
      type: Boolean,
      default: ADMIN_NOTIFICATION_DEFAULTS.isWhatsAppNotificationEnabled,
    },
    /**
     * The ceiling on one broadcast, settable without a deploy.
     *
     * ⚠️ A **refusal**, not a truncation — `resolveAudience` throws `422` above
     * it rather than sending to the first N. Silently reaching some of the
     * audience is the failure this number exists to prevent.
     *
     * ⚠️ Raising it does not make a broadcast free: every recipient is one row
     * written and one push queued, and FCM still takes 500 tokens per batch.
     * Past a few thousand this belongs in a background job, which is what the
     * refusal message says.
     */
    maxRecipientsPerDispatch: {
      type: Number,
      min: 1,
      default: ADMIN_NOTIFICATION_DEFAULTS.maxRecipientsPerDispatch,
    },
  },
  { _id: false },
);

/** Everything admin-audience. One block today; a namespace for later. */
const adminSettingSchema = new mongoose.Schema(
  {
    notification: {
      type: adminNotificationSchema,
      default: () => ({}),
    },
  },
  { _id: false },
);

/** Invoice numbering. Changing the prefix starts a new counter. */
const customerInvoiceSchema = new mongoose.Schema(
  {
    seriesPrefix: {
      type: String,
      default: CUSTOMER_INVOICE_DEFAULTS.seriesPrefix,
      uppercase: true,
      trim: true,
    },
  },
  { _id: false },
);

/** Withheld slice of a risky vendor's payout. Off for everyone by default. */
const settlementReserveSchema = new mongoose.Schema(
  {
    isEnabled: { type: Boolean, default: SETTLEMENT_DEFAULTS.reserve.isEnabled },
    percent: {
      type: Number,
      default: SETTLEMENT_DEFAULTS.reserve.percent,
      min: 0,
      max: 100,
    },
    holdDays: {
      type: Number,
      default: SETTLEMENT_DEFAULTS.reserve.holdDays,
      min: 0,
    },
    riskChargebackCount: {
      type: Number,
      default: SETTLEMENT_DEFAULTS.reserve.riskChargebackCount,
      min: 1,
    },
    riskLookbackDays: {
      type: Number,
      default: SETTLEMENT_DEFAULTS.reserve.riskLookbackDays,
      min: 1,
    },
    /**
     * ⚠️ `min: 1`. A floor of zero means every brand with one chargeback and
     * one sale reads as 100% risky on their first day.
     */
    riskMinPayments: {
      type: Number,
      default: SETTLEMENT_DEFAULTS.reserve.riskMinPayments,
      min: 1,
    },
    riskDisputeRatePercent: {
      type: Number,
      default: SETTLEMENT_DEFAULTS.reserve.riskDisputeRatePercent,
      min: 0,
      max: 100,
    },
    riskPercent: {
      type: Number,
      default: SETTLEMENT_DEFAULTS.reserve.riskPercent,
      min: 0,
      max: 100,
    },
    maxPercent: {
      type: Number,
      default: SETTLEMENT_DEFAULTS.reserve.maxPercent,
      min: 0,
      max: 100,
    },
  },
  { _id: false },
);

/**
 * Paying the vendor out.
 *
 * ⚠️ `delayDays` is load-bearing. It is the T+N floor the whole refund design
 * rests on, and lowering it below the sum of the refund windows is refused on
 * save by `assertSettlementTimingRule` — see `constants/customer.js`.
 */
const settlementSettingSchema = new mongoose.Schema(
  {
    isEnabled: { type: Boolean, default: SETTLEMENT_DEFAULTS.isEnabled },
    delayDays: { type: Number, default: SETTLEMENT_DEFAULTS.delayDays, min: 0 },
    payoutBufferHours: {
      type: Number,
      default: SETTLEMENT_DEFAULTS.payoutBufferHours,
      min: 0,
    },
    cycleType: {
      type: String,
      enum: Object.values(SETTLEMENT_CYCLE_TYPES),
      default: SETTLEMENT_DEFAULTS.cycleType,
    },
    requiresAdminApproval: {
      type: Boolean,
      default: SETTLEMENT_DEFAULTS.requiresAdminApproval,
    },
    minPayoutAmount: {
      type: Number,
      default: SETTLEMENT_DEFAULTS.minPayoutAmount,
      min: 0,
    },
    payoutProvider: {
      type: String,
      enum: Object.values(PAYOUT_PROVIDERS),
      default: SETTLEMENT_DEFAULTS.payoutProvider,
    },
    commissionPercent: {
      type: Number,
      default: SETTLEMENT_DEFAULTS.commissionPercent,
      min: 0,
      max: 100,
    },
    reserve: { type: settlementReserveSchema, default: () => ({}) },
    newVendorReserveDays: {
      type: Number,
      default: SETTLEMENT_DEFAULTS.newVendorReserveDays,
      min: 0,
    },
    notReceivedAlertHours: {
      type: Number,
      default: SETTLEMENT_DEFAULTS.notReceivedAlertHours,
      min: 1,
    },
    gatewayFeeBearer: {
      type: String,
      enum: Object.values(GATEWAY_FEE_BEARER),
      default: SETTLEMENT_DEFAULTS.gatewayFeeBearer,
    },
  },
  { _id: false },
);

/**
 * Refunds.
 *
 * ⚠️ `windowHours + vendorApprovalHours + adminBufferHours` may not exceed
 * `settlement.delayDays * 24`. Enforced on save, not here — the rule spans two
 * blocks and a partial PATCH of either one can break it.
 */
const refundSettingSchema = new mongoose.Schema(
  {
    method: {
      type: String,
      enum: Object.values(REFUND_METHODS),
      default: REFUND_DEFAULTS.method,
    },
    windowHours: { type: Number, default: REFUND_DEFAULTS.windowHours, min: 0 },
    vendorApprovalHours: {
      type: Number,
      default: REFUND_DEFAULTS.vendorApprovalHours,
      min: 0,
    },
    adminBufferHours: {
      type: Number,
      default: REFUND_DEFAULTS.adminBufferHours,
      min: 0,
    },
    onVendorTimeout: {
      type: String,
      enum: Object.values(VENDOR_TIMEOUT_ACTIONS),
      default: REFUND_DEFAULTS.onVendorTimeout,
    },
    allowPartial: { type: Boolean, default: REFUND_DEFAULTS.allowPartial },
    releasePromoOnRefund: {
      type: Boolean,
      default: REFUND_DEFAULTS.releasePromoOnRefund,
    },
    authorizedAlertMinutes: {
      type: Number,
      default: REFUND_DEFAULTS.authorizedAlertMinutes,
      min: 1,
    },

    /**
     * ---------- abuse limits ----------
     *
     * These count **refused** requests, never approved ones — see
     * `REFUND_DEFAULTS`. A customer with five approved refunds had five bad
     * experiences, and blocking their sixth punishes the person the process
     * exists for.
     */
    maxOpenRequests: {
      type: Number,
      default: REFUND_DEFAULTS.maxOpenRequests,
      min: 1,
    },
    maxRejectedPerWindow: {
      type: Number,
      default: REFUND_DEFAULTS.maxRejectedPerWindow,
      min: 1,
    },
    requestWindowDays: {
      type: Number,
      default: REFUND_DEFAULTS.requestWindowDays,
      min: 1,
    },
    /**
     * `MANUAL_BANK`: when the customer is nudged for their account details, and
     * when a silent one becomes an admin's problem.
     *
     * ⚠️ An unset array of numbers arrives as `[]`, not `undefined`, which is why
     * `getCustomerConfig` falls back on **length**. Clearing this in the panel
     * would otherwise stop every nudge while the job kept reporting healthy runs.
     */
    bankDetailsReminderHours: {
      type: [Number],
      default: () => [...REFUND_DEFAULTS.bankDetailsReminderHours],
    },
    bankDetailsStaleDays: {
      type: Number,
      default: REFUND_DEFAULTS.bankDetailsStaleDays,
      min: 1,
    },
  },
  { _id: false },
);

const chargebackSettingSchema = new mongoose.Schema(
  {
    writeOffDays: {
      type: Number,
      default: CHARGEBACK_DEFAULTS.writeOffDays,
      min: 1,
    },
    /**
     * Hours before `disputeRespondBy` at which an admin is warned.
     *
     * ⚠️ `disputeDeadlines` sorts these widest-first itself rather than trusting
     * the stored order: saved as `[24, 72]` they would otherwise fire the 24h
     * warning three days early and the 72h one never.
     *
     * ⚠️ An unset array of numbers arrives as `[]`, not `undefined` — which is
     * why `getCustomerConfig` falls back on **length** rather than `??`. Without
     * that, clearing this in the admin panel would silently stop every warning
     * until the deadline had already gone.
     */
    deadlineAlertHours: {
      type: [Number],
      default: () => [...CHARGEBACK_DEFAULTS.deadlineAlertHours],
    },
  },
  { _id: false },
);

/**
 * The customer home screen's search box.
 *
 * ⚠️ `isEnabled: false` empties the results, it does not remove the endpoint.
 * `GET /search` keeps answering 200 with a plain "search is unavailable" so the
 * app can say so; a 404 or 500 would reach the client's generic error handler
 * and show a broken-app screen for what was a deliberate switch.
 */
const searchSettingSchema = new mongoose.Schema(
  {
    isEnabled: { type: Boolean, default: CUSTOMER_SEARCH_DEFAULTS.isEnabled },
    // ⚠️ At least 1. A zero would let an empty query through to a match that
    // scans brands, vouchers, categories and every outlet address at once.
    minQueryLength: {
      type: Number,
      default: CUSTOMER_SEARCH_DEFAULTS.minQueryLength,
      min: 1,
      max: 10,
    },
    sectionLimit: {
      type: Number,
      default: CUSTOMER_SEARCH_DEFAULTS.sectionLimit,
      min: 1,
      max: SEARCH_LIMITS.MAX_SECTION_LIMIT,
    },
    historyLimit: {
      type: Number,
      default: CUSTOMER_SEARCH_DEFAULTS.historyLimit,
      min: 1,
      max: 100,
    },
    /**
     * Admin-curated chips for the empty search box. Nothing derives these from
     * traffic — no query a customer types is logged anywhere.
     *
     * ⚠️ An unset array of strings arrives as `[]`, not `undefined`, so
     * `getCustomerConfig` cannot use `??` here. Clearing the list in the admin
     * panel is a legitimate choice and must survive the read.
     */
    popularQueries: {
      type: [String],
      default: () => [...CUSTOMER_SEARCH_DEFAULTS.popularQueries],
    },
  },
  { _id: false },
);

const customerSettingSchema = new mongoose.Schema(
  {
    convenienceFee: { type: convenienceFeeSchema, default: () => ({}) },
    tax: { type: customerTaxSchema, default: () => ({}) },
    promoCode: { type: customerPromoSchema, default: () => ({}) },
    claim: { type: claimSettingSchema, default: () => ({}) },
    notification: { type: customerNotificationSchema, default: () => ({}) },
    invoice: { type: customerInvoiceSchema, default: () => ({}) },
    settlement: { type: settlementSettingSchema, default: () => ({}) },
    refund: { type: refundSettingSchema, default: () => ({}) },
    chargeback: { type: chargebackSettingSchema, default: () => ({}) },
    search: { type: searchSettingSchema, default: () => ({}) },
  },
  { _id: false },
);

/**
 * One-time codes.
 *
 * ⚠️ Its own top-level block rather than living under `customer`, because
 * vendors, sub-vendors and customers all log in with the same OTP machinery.
 * Filing it under one audience would mean the other two were throttled by a
 * setting nobody would think to look at.
 */
const otpSettingSchema = new mongoose.Schema(
  {
    resendCooldownSeconds: {
      type: Number,
      default: OTP_DEFAULTS.resendCooldownSeconds,
      min: 0,
    },
    maxPerHour: {
      type: Number,
      default: OTP_DEFAULTS.maxPerHour,
      // ⚠️ At least one. A zero here would lock **everybody** out of logging in,
      // silently, from a settings screen — and the way back in is also a login.
      min: 1,
    },
  },
  { _id: false },
);

const securitySettingSchema = new mongoose.Schema(
  { otp: { type: otpSettingSchema, default: () => ({}) } },
  { _id: false },
);

/**
 * The only block that is readable **without a token**.
 *
 * ⚠️ Everything in here reaches `GET /app-config`, which is public. Nothing
 * about money, commission, reserve or settlement timing belongs in this schema —
 * not because the endpoint filters it out, but because the endpoint builds its
 * answer from a whitelist and a field added here is a field somebody intended to
 * publish. Keep it that way: the moment a rate lands in this block it is one
 * mistake away from being public.
 *
 * Defaults live in `constants/app.js`, like every other block.
 */
const appVersionSchema = new mongoose.Schema(
  {
    android: { type: String, default: APP_CONFIG_DEFAULTS.minVersion.android },
    ios: { type: String, default: APP_CONFIG_DEFAULTS.minVersion.ios },
  },
  { _id: false },
);

const appSupportSchema = new mongoose.Schema(
  {
    email: { type: String, default: APP_CONFIG_DEFAULTS.support.email },
    phone: { type: String, default: APP_CONFIG_DEFAULTS.support.phone },
    whatsapp: { type: String, default: APP_CONFIG_DEFAULTS.support.whatsapp },
  },
  { _id: false },
);

const appFeatureSchema = new mongoose.Schema(
  {
    promoCodes: { type: Boolean, default: APP_CONFIG_DEFAULTS.features.promoCodes },
    refunds: { type: Boolean, default: APP_CONFIG_DEFAULTS.features.refunds },
    voucherClaims: {
      type: Boolean,
      default: APP_CONFIG_DEFAULTS.features.voucherClaims,
    },
    search: { type: Boolean, default: APP_CONFIG_DEFAULTS.features.search },
  },
  { _id: false },
);

const appSettingSchema = new mongoose.Schema(
  {
    minVersion: { type: appVersionSchema, default: () => ({}) },
    latestVersion: { type: appVersionSchema, default: () => ({}) },
    forceUpdate: { type: Boolean, default: APP_CONFIG_DEFAULTS.forceUpdate },
    updateMessage: { type: String, default: APP_CONFIG_DEFAULTS.updateMessage },
    storeUrl: {
      type: new mongoose.Schema(
        {
          android: { type: String, default: APP_CONFIG_DEFAULTS.storeUrl.android },
          ios: { type: String, default: APP_CONFIG_DEFAULTS.storeUrl.ios },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    support: { type: appSupportSchema, default: () => ({}) },
    features: { type: appFeatureSchema, default: () => ({}) },
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
    security: {
      type: securitySettingSchema,
      default: () => ({}),
    },
    /**
     * ⚠️ Its own top-level block, beside `vendor` and `customer`, rather than a
     * corner of one of them — because the whole point is that the three cannot
     * silence each other.
     */
    admin: {
      type: adminSettingSchema,
      default: () => ({}),
    },
    // ⚠️ The only block `GET /app-config` may read — and it is public.
    app: {
      type: appSettingSchema,
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
