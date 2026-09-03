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

  // An admin switched the vendor's account off or back on. CRITICAL on the way
  // off — the vendor loses all access the moment it lands, so this is the only
  // notice explaining why.
  BRAND_DEACTIVATED: "BRAND_DEACTIVATED",
  BRAND_ACTIVATED: "BRAND_ACTIVATED",
  // An admin de-listed the brand from the customer app, or put it back. A
  // separate switch from the two above: the vendor keeps (or keeps losing)
  // access either way, and this is about what customers can see.
  BRAND_HIDDEN_FROM_CUSTOMERS: "BRAND_HIDDEN_FROM_CUSTOMERS",
  BRAND_VISIBLE_TO_CUSTOMERS: "BRAND_VISIBLE_TO_CUSTOMERS",

  // ---------- onboarding / verification, vendor-facing ----------
  // Documents submitted and the brand is now queued for a human. The
  // "we have your application" acknowledgement.
  BRAND_UNDER_REVIEW: "BRAND_UNDER_REVIEW",
  // Resubmitted after a rejection — a distinct message, because "received"
  // and "received again" read differently to someone who has been rejected once.
  BRAND_RESUBMITTED: "BRAND_RESUBMITTED",
  // The one that matters. CRITICAL is wrong here — it is good news.
  BRAND_APPROVED: "BRAND_APPROVED",
  // Carries the admin's reason. Without it the vendor has nothing to act on.
  BRAND_REJECTED: "BRAND_REJECTED",
  // An approval withdrawn after it was granted. Distinct from REJECTED, which
  // means it was never approved at all.
  BRAND_APPROVAL_REVOKED: "BRAND_APPROVAL_REVOKED",

  // A message an admin composed and sent to a chosen audience. Deliberately
  // generic: it is not tied to any domain, so the same broadcast path serves
  // vendors, customers, and any role added later.
  ANNOUNCEMENT: "ANNOUNCEMENT",

  // ---------- admin-audience ----------
  // A payment arrived but could not be settled. Money is captured and the plan
  // is not live, so somebody has to look.
  // ---------- customer voucher claims ----------
  // The receipt, and the one that carries the Download Invoice button.
  VOUCHER_PAYMENT_SUCCESS: "VOUCHER_PAYMENT_SUCCESS",
  VOUCHER_PAYMENT_FAILED: "VOUCHER_PAYMENT_FAILED",
  VOUCHER_REFUNDED: "VOUCHER_REFUNDED",

  /**
   * ---------- refunds ----------
   *
   * One type per state the reader can act on, not one per state that exists.
   * `PROCESSING` and `ADMIN_APPROVED` are real transitions but there is nothing
   * for anyone to do about them, and a notification nobody acts on trains
   * people to ignore the ones that matter.
   */
  REFUND_REQUESTED: "REFUND_REQUESTED",
  REFUND_APPROVED: "REFUND_APPROVED",
  REFUND_REJECTED: "REFUND_REJECTED",
  REFUND_FAILED: "REFUND_FAILED",
  REFUND_ESCALATED: "REFUND_ESCALATED",
  REFUND_REMINDER: "REFUND_REMINDER",

  /**
   * Settlements — the vendor's side of the same money.
   *
   * Same rule as the refunds above: one type per state somebody can act on.
   * `PENDING_APPROVAL` and `APPROVED` are not here — from the vendor's side
   * nothing has happened yet that they could do anything about, and a payout
   * that is merely scheduled is not news. `PAID` is, because it carries the UTR
   * they need to find it on their statement.
   */
  SETTLEMENT_PAID: "SETTLEMENT_PAID",
  SETTLEMENT_FAILED: "SETTLEMENT_FAILED",
  SETTLEMENT_ON_HOLD: "SETTLEMENT_ON_HOLD",
  /**
   * Admin only. A payout that left and was never confirmed — `MANUAL_BANK` has
   * no callback, so a NEFT started at 4pm and forgotten leaves the settlement
   * `PROCESSING` for ever and the vendor reading "on its way to your bank"
   * indefinitely. Nothing errors; it simply stops.
   */
  SETTLEMENT_STUCK: "SETTLEMENT_STUCK",
  // Admin only. Money owed past the window an admin agreed to pay it in.
  SETTLEMENT_LATE: "SETTLEMENT_LATE",
  /**
   * Admin only, CRITICAL. The payout ledger and the legs disagree, which means
   * one of the two is wrong about money that has physically moved.
   */
  SETTLEMENT_LEDGER_DRIFT: "SETTLEMENT_LEDGER_DRIFT",
  // To the vendor and the outlet, not the customer.
  VOUCHER_CLAIM_RECEIVED: "VOUCHER_CLAIM_RECEIVED",
  // Phase 2: a paid claim that was never scanned inside its window.
  VOUCHER_CLAIM_EXPIRED: "VOUCHER_CLAIM_EXPIRED",

  WEBHOOK_FAILED: "WEBHOOK_FAILED",
  // A chargeback. There is a response deadline; missing it forfeits the money.
  PAYMENT_DISPUTED: "PAYMENT_DISPUTED",
  // A paying brand's plan lapsed — revenue lost, worth a follow-up.
  BRAND_SUBSCRIPTION_LAPSED: "BRAND_SUBSCRIPTION_LAPSED",
  // A promo code went past its cap because a payment quoted before the code ran
  // out was settled afterwards. Nothing to undo — but somebody should know.
  PROMO_LIMIT_EXCEEDED: "PROMO_LIMIT_EXCEEDED",

  // A brand is waiting on a human decision. Deliberately the only two
  // vendor-triggered events that reach the admin feed: both mean somebody has
  // to act. A vendor filling in their PAN does not.
  BRAND_AWAITING_REVIEW: "BRAND_AWAITING_REVIEW",
  BRAND_AWAITING_RE_REVIEW: "BRAND_AWAITING_RE_REVIEW",
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
