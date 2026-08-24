const { getSetting } = require("./getSetting");
const { SUBSCRIPTION_DEFAULTS } = require("../../constants/subscription");

// DB config (Setting.vendor.subscription) always wins; SUBSCRIPTION_DEFAULTS
// only kicks in as a last-resort fallback if the singleton Setting doc somehow
// lacks a value. Nothing in the subscription flow may hardcode a GST rate, a
// policy flag or the seller's identity — it all comes through here so an admin
// can change it without a deploy.
exports.getSubscriptionConfig = async () => {
  const setting = await getSetting();
  const s = setting?.vendor?.subscription || {};
  const d = SUBSCRIPTION_DEFAULTS;

  // `??` and not `||` on purpose: 0 is a legitimate value for gstPercentage and
  // gracePeriodDays, and false is legitimate for every flag below.
  return {
    gstPercentage: s.gstPercentage ?? d.gstPercentage,
    isGstInclusive: s.isGstInclusive ?? d.isGstInclusive,
    hsnSacCode: s.hsnSacCode || d.hsnSacCode,
    currency: s.currency || d.currency,
    currencySymbol: d.currencySymbol,

    companyName: s.companyName || d.companyName,
    companyGstin: s.companyGstin || d.companyGstin,
    companyAddress: s.companyAddress || d.companyAddress,
    companyStateCode: s.companyStateCode || d.companyStateCode,
    companyState: s.companyState || d.companyState,

    allowVendorUpgrade: s.allowVendorUpgrade ?? d.allowVendorUpgrade,
    allowVendorDowngrade: s.allowVendorDowngrade ?? d.allowVendorDowngrade,
    allowVendorRenewal: s.allowVendorRenewal ?? d.allowVendorRenewal,
    allowAdminDowngrade: s.allowAdminDowngrade ?? d.allowAdminDowngrade,
    allowAdminFreeGrant: s.allowAdminFreeGrant ?? d.allowAdminFreeGrant,

    gracePeriodDays: s.gracePeriodDays ?? d.gracePeriodDays,
    pendingOrderReuseMinutes:
      s.pendingOrderReuseMinutes ?? d.pendingOrderReuseMinutes,
    expiryJobIntervalMinutes:
      s.expiryJobIntervalMinutes ?? d.expiryJobIntervalMinutes,

    isPromoCodeEnabled: s.isPromoCodeEnabled ?? d.isPromoCodeEnabled,

    expiryReminderDays: s.expiryReminderDays?.length
      ? [...s.expiryReminderDays]
      : [...d.expiryReminderDays],
    reminderJobIntervalMinutes:
      s.reminderJobIntervalMinutes ?? d.reminderJobIntervalMinutes,
    isEmailNotificationEnabled:
      s.isEmailNotificationEnabled ?? d.isEmailNotificationEnabled,
    isPushNotificationEnabled:
      s.isPushNotificationEnabled ?? d.isPushNotificationEnabled,
    isWhatsAppNotificationEnabled:
      s.isWhatsAppNotificationEnabled ?? d.isWhatsAppNotificationEnabled,

    isActive: s.isActive ?? true,
  };
};
