/**
 * Notification enums.
 *
 * The platform had no notification layer at all — only two hard-coded OTP mail
 * helpers. This is the minimum shared vocabulary so subscription events (and
 * anything added later) can be persisted, listed in-app, and emailed through
 * one path instead of each domain inventing its own.
 */

const NOTIFICATION_AUDIENCE = Object.freeze({
  VENDOR: "VENDOR",
  ADMIN: "ADMIN",
  CUSTOMER: "CUSTOMER",
});

const NOTIFICATION_TYPES = Object.freeze({
  SUBSCRIPTION_ACTIVATED: "SUBSCRIPTION_ACTIVATED",
  SUBSCRIPTION_RENEWED: "SUBSCRIPTION_RENEWED",
  SUBSCRIPTION_UPGRADED: "SUBSCRIPTION_UPGRADED",
  SUBSCRIPTION_DOWNGRADED: "SUBSCRIPTION_DOWNGRADED",
  SUBSCRIPTION_GRANTED: "SUBSCRIPTION_GRANTED",
  SUBSCRIPTION_EXPIRING: "SUBSCRIPTION_EXPIRING",
  SUBSCRIPTION_EXPIRED: "SUBSCRIPTION_EXPIRED",
  SUBSCRIPTION_CANCELLED: "SUBSCRIPTION_CANCELLED",
  LIMIT_REACHED: "LIMIT_REACHED",

  // A message an admin composed and sent to a chosen audience. Deliberately
  // generic: it is not tied to any domain, so the same broadcast path serves
  // vendors, customers, and any role added later.
  ANNOUNCEMENT: "ANNOUNCEMENT",

  // ---------- admin-audience ----------
  // A payment arrived but could not be settled. Money is captured and the plan
  // is not live, so somebody has to look.
  WEBHOOK_FAILED: "WEBHOOK_FAILED",
  // A chargeback. There is a response deadline; missing it forfeits the money.
  PAYMENT_DISPUTED: "PAYMENT_DISPUTED",
  // A paying brand's plan lapsed — revenue lost, worth a follow-up.
  BRAND_SUBSCRIPTION_LAPSED: "BRAND_SUBSCRIPTION_LAPSED",
  // A promo code went past its cap because a payment quoted before the code ran
  // out was settled afterwards. Nothing to undo — but somebody should know.
  PROMO_LIMIT_EXCEEDED: "PROMO_LIMIT_EXCEEDED",
});

// Where a notification was actually delivered. IN_APP is always written; the
// rest are attempted when a destination exists and the channel is enabled.
const NOTIFICATION_CHANNELS = Object.freeze({
  IN_APP: "IN_APP",
  EMAIL: "EMAIL",
  PUSH: "PUSH",
  // Reserved — the TENDIGIT provider exists for OTP, but WhatsApp Business
  // requires a pre-approved template per message type.
  WHATSAPP: "WHATSAPP",
});

// Which device a push token belongs to. Kept explicit so a provider that needs
// platform-specific payload shaping has something to branch on.
const DEVICE_PLATFORMS = Object.freeze({
  ANDROID: "ANDROID",
  IOS: "IOS",
  WEB: "WEB",
});

/**
 * How a notification's recipients are described.
 *
 * Deliberately declarative and role-agnostic: the same shape addresses one user,
 * every user of a role, the owners of specific brands, or everybody. Nothing in
 * here is subscription-specific, so customer-facing and future-role
 * notifications use exactly the same targeting.
 *
 * Resolved by `helpers/notifications/resolveAudience.js`.
 */
const AUDIENCE_TARGETS = Object.freeze({
  // Specific users, by id.
  USER_IDS: "userIds",
  // Every active user holding one of these roles.
  ROLES: "roles",
  // The owning user of each brand.
  BRAND_IDS: "brandIds",
  // The user behind each customer profile.
  CUSTOMER_IDS: "customerIds",
  // The sub-vendor user of each outlet.
  SUB_BRAND_IDS: "subBrandIds",
  // Everyone active. Guarded — see resolveAudience.
  ALL: "all",
});

// A single dispatch cannot exceed this many recipients. A broadcast beyond it
// should go through a job rather than a request, so one call cannot tie up the
// process or the provider quota.
const AUDIENCE_LIMITS = Object.freeze({
  MAX_RECIPIENTS_PER_DISPATCH: 5000,
  // FCM accepts up to 500 tokens per multicast batch.
  MAX_TOKENS_PER_PUSH_BATCH: 500,
});

const NOTIFICATION_SEVERITY = Object.freeze({
  INFO: "INFO",
  WARNING: "WARNING",
  CRITICAL: "CRITICAL",
});

const NOTIFICATION_DEFAULTS = Object.freeze({
  maxTitleLength: 160,
  maxBodyLength: 1000,
  listPageSize: 20,
});

module.exports = {
  NOTIFICATION_AUDIENCE,
  DEVICE_PLATFORMS,
  AUDIENCE_TARGETS,
  AUDIENCE_LIMITS,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_SEVERITY,
  NOTIFICATION_DEFAULTS,
};
