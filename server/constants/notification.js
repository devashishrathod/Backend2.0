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
   * ⚠️ The one `CARRIED_FORWARD` that is news.
   *
   * Two very different things wear that status. *"Below the ₹500 minimum, it
   * rolls into next time"* is routine and rightly silent. *"Your deductions came
   * to more than your sales, so nothing is being paid and the balance follows
   * you into the next cycle"* is not — and it was silent too.
   *
   * From the outlet's side that is indistinguishable from a payout that simply
   * failed to happen: they traded, they expected money, none arrived, and no
   * message explained it. The first anyone heard was a support call, usually
   * weeks later and usually about a chargeback whose deadline had passed.
   */
  SETTLEMENT_CARRIED_FORWARD: "SETTLEMENT_CARRIED_FORWARD",
  /**
   * Admin only. A brand's deductions that no cycle can reach.
   *
   * A negative `netPayable` carries forward, and carrying forward releases every
   * claim it held — right while the brand still trades, an endless silent loop
   * the day they stop. Nothing errors and no report shows it, so this is the
   * only thing that ever says the money is not coming back.
   */
  VENDOR_DEBT_AGED: "VENDOR_DEBT_AGED",
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
  /**
   * Admin only, CRITICAL. A blanket unique index was found shadowing a partial
   * one and removed.
   *
   * ⚠️ The alert is not really about the index — that is already fixed by the
   * time this is sent. It is about **what put it there**. Nothing in this build
   * creates one, so a shadow index appearing means another process wrote to this
   * database, and the timestamp on this notice is the only usable lead for
   * finding it: the old writer restarted inside the sweep window that caught it.
   *
   * CRITICAL because of what the index does while it is there. A blanket unique
   * on a nullable path rejects the **second** row with no value, and every
   * voucher claim is created before its invoice exists — so in production it is
   * every second claim failing, with a duplicate-key error naming a field the
   * customer never touched.
   */
  SHADOW_INDEX_REAPED: "SHADOW_INDEX_REAPED",
  // To the vendor and the outlet, not the customer.
  VOUCHER_CLAIM_RECEIVED: "VOUCHER_CLAIM_RECEIVED",
  // Phase 2: a paid claim that was never scanned inside its window.
  VOUCHER_CLAIM_EXPIRED: "VOUCHER_CLAIM_EXPIRED",

  WEBHOOK_FAILED: "WEBHOOK_FAILED",
  // A chargeback. There is a response deadline; missing it forfeits the money.
  PAYMENT_DISPUTED: "PAYMENT_DISPUTED",
  /**
   * That deadline, getting close — or already gone.
   *
   * `PAYMENT_DISPUTED` fires once, when the dispute opens, and by the time the
   * deadline matters it has long scrolled away. This is the one that arrives
   * while there is still something to do about it.
   */
  DISPUTE_DEADLINE: "DISPUTE_DEADLINE",
  /**
   * To the **vendor**: a customer's bank has pulled a payment back on one of
   * their sales.
   *
   * ⚠️ Before this they were told nothing. The money simply never appeared in a
   * settlement, and weeks later a statement carried a deduction with no sale
   * attached to it — which reads as money taken without explanation, however
   * correct the arithmetic was.
   */
  DISPUTE_RAISED_VENDOR: "DISPUTE_RAISED_VENDOR",
  /** And how it ended — won, so the hold lifts; or lost, so it is deducted. */
  DISPUTE_RESOLVED_VENDOR: "DISPUTE_RESOLVED_VENDOR",
  /**
   * The refund could not go back the way it came, and we need an account to
   * send it to. The only refund notice that asks the customer to **do**
   * something — so it is also the only one where silence means the money stays
   * with us.
   */
  REFUND_BANK_DETAILS_REQUESTED: "REFUND_BANK_DETAILS_REQUESTED",
  /**
   * To an **admin**: a customer was asked for an account and never answered.
   *
   * Not about the customer's money — that stays theirs and the refund stays
   * open. It is about the vendor's: the settlement hold behind it has been
   * frozen for weeks, and one silent customer should not cost a vendor for ever.
   */
  REFUND_BANK_DETAILS_STALE: "REFUND_BANK_DETAILS_STALE",
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

/**
 * The notifications a personal preference cannot silence.
 *
 * ### The rule, so this list can be argued with rather than guessed at
 *
 * A type belongs here only if **one** of these is true:
 *
 *  1. the notice itself is what cuts the reader off from the in-app feed, so
 *     there is no other way for them to ever learn it; or
 *  2. money is held, owed or forfeit until somebody acts, and silence means it
 *     stays that way.
 *
 * Everything else is silenceable. A vendor who muted email can still open the
 * app and read the row — that is what makes the row the record.
 *
 * ### ⚠️ Severity is not the test
 *
 * `CRITICAL` looks like the obvious rule and is the wrong one.
 * `REFUND_BANK_DETAILS_REQUESTED` is deliberately `INFO` — *"alarming someone
 * about their own money is how a real message gets mistaken for a fake one"* —
 * and it is the single notice that most has to arrive, because the customer's
 * refund sits with us until they answer it. Severity says how loud; this says
 * whether it may be dropped.
 *
 * ### ⚠️ This overrides the person, never the platform
 *
 * The admin's platform toggles are an operational kill switch — SMTP down, or
 * WhatsApp templates not yet approved by Meta. Bypassing those would mean
 * attempting a send that the provider rejects out of sight. Only the individual's
 * own preference is overridden.
 */
const ALWAYS_DELIVER_TYPES = Object.freeze([
  /**
   * Rule 1, in its purest form. The vendor cannot sign in — so the in-app row
   * exists and is unreachable — and push is switched off in this notice on
   * purpose, because the same operation retires their device tokens. Email and
   * WhatsApp are not the preferred channels here; they are the only ones.
   */
  "BRAND_DEACTIVATED",
  /**
   * Rule 2. The refund could not go back the way it came, and the money stays
   * with us until the customer supplies an account. It is also the only
   * customer notice that asks them to do anything.
   */
  "REFUND_BANK_DETAILS_REQUESTED",
  /**
   * Rule 2, admin side. A customer has been told their money is coming and it
   * has not arrived; nothing in the system will fix it, only a person retrying
   * or switching to a bank transfer.
   */
  "REFUND_FAILED",
  /** Rule 2. The payout legs and the ledger disagree about money that has physically moved. */
  "SETTLEMENT_LEDGER_DRIFT",
  /**
   * Rule 2, indirectly and at scale: while a shadow index is present, roughly
   * every second voucher claim fails with a duplicate-key error on a field the
   * customer never touched.
   */
  "SHADOW_INDEX_REAPED",
  /**
   * Rule 2. Missing a dispute deadline forfeits the money automatically. The
   * bank does not ask twice and Razorpay does not chase.
   */
  "DISPUTE_DEADLINE",
]);

/** True when a type must be delivered whatever the recipient has switched off. */
const alwaysDelivers = (type) => ALWAYS_DELIVER_TYPES.includes(type);

/**
 * The channels a person can switch off for themselves.
 *
 * ⚠️ `IN_APP` is deliberately **not** here. The notification row is the record —
 * it is what the feed reads, what an admin opens to answer "what were they
 * told?", and what every delivery outcome is written back onto. A preference
 * that could stop the row being written would be a preference to have no
 * history, and the outbound channels would then have nothing to report against.
 *
 * Keyed by the preference field name, valued by the channel it governs, so the
 * two can never drift apart.
 */
const NOTIFICATION_PREFERENCE_CHANNELS = Object.freeze({
  email: "EMAIL",
  push: "PUSH",
  whatsapp: "WHATSAPP",
});

/**
 * The same three channels, named the way the **platform** settings spell them.
 *
 * `Setting.<audience>.…isEmailNotificationEnabled` and
 * `User.notificationPreferences.email` are the same channel in two vocabularies,
 * and every place that combines them needs the translation. Declared once here
 * so a fourth channel is one entry rather than a hunt.
 */
const PLATFORM_CHANNEL_KEYS = Object.freeze({
  email: "isEmailNotificationEnabled",
  push: "isPushNotificationEnabled",
  whatsapp: "isWhatsAppNotificationEnabled",
});

/**
 * Everything on, for everybody, until they say otherwise.
 *
 * ⚠️ These are the defaults for a **new** `User` document. Every user that
 * already exists has no `notificationPreferences` field at all, and a missing
 * field must read as **on** — see `helpers/notifications/channelPreferences.js`,
 * which is the only place allowed to make that decision.
 */
const NOTIFICATION_PREFERENCE_DEFAULTS = Object.freeze({
  email: true,
  push: true,
  whatsapp: true,
});

/**
 * The admin audience's platform toggles.
 *
 * ⚠️ WhatsApp is the only one off, and for the same reason it is off for vendors
 * and customers: a Meta-approved template per message type does not exist yet.
 * Email and push are **on**, and an admin alert is the last thing that should be
 * silent by default — these are the messages sent when money has already gone
 * wrong.
 *
 * An admin who personally wants fewer emails has
 * `User.notificationPreferences`, which quiets them without quieting the team.
 */
const ADMIN_NOTIFICATION_DEFAULTS = Object.freeze({
  isEmailNotificationEnabled: true,
  isPushNotificationEnabled: true,
  isWhatsAppNotificationEnabled: false,
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
  NOTIFICATION_PREFERENCE_CHANNELS,
  PLATFORM_CHANNEL_KEYS,
  NOTIFICATION_PREFERENCE_DEFAULTS,
  ADMIN_NOTIFICATION_DEFAULTS,
  ALWAYS_DELIVER_TYPES,
  alwaysDelivers,
};
