/**
 * Subscription / Subscribed lifecycle enums and last-resort fallbacks.
 *
 * IMPORTANT: every tunable value in here is a *fallback only*. The live value
 * comes from `Setting.vendor.subscription` (DB) via
 * `helpers/settings/getSubscriptionConfig.js`. Nothing in the codebase should
 * read SUBSCRIPTION_DEFAULTS directly — go through the helper so an admin can
 * always override it.
 */

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// The single source of truth for "is this brand subscribed right now".
// `Brand.isSubscribed` is only a denormalized cache of ACTIVE + endDate > now.
const SUBSCRIBED_STATUS = Object.freeze({
  PENDING: "PENDING", // doc created, payment not verified yet
  ACTIVE: "ACTIVE", // paid or admin-granted, endDate in the future
  EXPIRED: "EXPIRED", // endDate has passed
  UPGRADED: "UPGRADED", // superseded by a higher-priced plan
  DOWNGRADED: "DOWNGRADED", // superseded by a lower-priced plan
  CANCELLED: "CANCELLED", // revoked by an admin before endDate
});

// A Subscribed doc in any of these states can never be the brand's live plan.
const SUBSCRIBED_TERMINAL_STATUSES = Object.freeze([
  SUBSCRIBED_STATUS.EXPIRED,
  SUBSCRIBED_STATUS.UPGRADED,
  SUBSCRIBED_STATUS.DOWNGRADED,
  SUBSCRIBED_STATUS.CANCELLED,
]);

// What the vendor/admin is about to do, derived by comparing the requested plan
// against whatever is currently active. Drives the checkout copy and the gates.
const SUBSCRIPTION_ACTION = Object.freeze({
  NEW: "NEW", // no active plan at all
  RENEW: "RENEW", // same plan again
  UPGRADE: "UPGRADE", // higher-priced plan
  DOWNGRADE: "DOWNGRADE", // lower-priced plan
});

const SUBSCRIPTION_SOURCE = Object.freeze({
  PAYMENT: "PAYMENT", // vendor paid online
  ADMIN_PAYMENT: "ADMIN_PAYMENT", // admin drove an online payment for the vendor
  ADMIN_MANUAL: "ADMIN_MANUAL", // admin granted it with no online payment
});

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

const PAYMENT_GATEWAYS = Object.freeze({
  RAZORPAY: "RAZORPAY",
  MANUAL: "MANUAL", // admin grant — free, cash, bank transfer, cheque
});

const MANUAL_PAYMENT_MODES = Object.freeze({
  FREE: "FREE",
  CASH: "CASH",
  BANK_TRANSFER: "BANK_TRANSFER",
  CHEQUE: "CHEQUE",
  UPI_OFFLINE: "UPI_OFFLINE",
});

const DISCOUNT_TYPES = Object.freeze({
  PERCENT: "PERCENT",
  FLAT: "FLAT",
});

// Intra-state supply is split CGST + SGST; inter-state is a single IGST line.
const GST_TAX_TYPES = Object.freeze({
  CGST_SGST: "CGST_SGST",
  IGST: "IGST",
});

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

const SUBSCRIPTION_HISTORY_ACTION = Object.freeze({
  ORDER_CREATED: "ORDER_CREATED",
  ACTIVATED: "ACTIVATED",
  RENEWED: "RENEWED",
  UPGRADED: "UPGRADED",
  DOWNGRADED: "DOWNGRADED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
  ADMIN_GRANTED: "ADMIN_GRANTED",
});

const HISTORY_PERFORMED_BY = Object.freeze({
  VENDOR: "VENDOR",
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM", // the expiry job
});

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

// Where the entitlements actually being enforced came from. Surfaced in admin
// responses so it is obvious which plans still need configuring properly.
const ENTITLEMENT_SOURCE = Object.freeze({
  DB: "DB", // Subscription.entitlements — the good case
  DERIVED: "DERIVED", // parsed out of the legacy free-text features[]
  DEFAULT: "DEFAULT", // nothing usable found, fell back to DEFAULT_ENTITLEMENTS
});

/**
 * The metered buckets. Every one is an *independent* pool — none draws from
 * another. A SubBrand row with outletType OUTLET consumes `subBrands`,
 * outletType FRANCHISE consumes `franchises`, a Voucher consumes `vouchers`,
 * a ShowcaseSection consumes `showcase`.
 *
 * All four share the same `{ limit, isUnlimited }` shape and the same atomic
 * reserve / release / recount machinery, so there is one implementation and one
 * set of error messages rather than four.
 */
const ENTITLEMENT_BUCKETS = Object.freeze({
  SUB_BRANDS: "subBrands",
  FRANCHISES: "franchises",
  VOUCHERS: "vouchers",
  SHOWCASE: "showcase",
});

// Bucket -> the Brand fields that meter it. Keeps the field names in one place
// so the atomic reserve/release helpers cannot drift from the schema.
const BUCKET_BRAND_FIELDS = Object.freeze({
  subBrands: Object.freeze({
    limit: "subBrandsLimit",
    used: "subBrandsUsed",
    isUnlimited: "isSubBrandsUnlimited",
  }),
  franchises: Object.freeze({
    limit: "franchisesLimit",
    used: "franchisesUsed",
    isUnlimited: "isFranchisesUnlimited",
  }),
  vouchers: Object.freeze({
    limit: "vouchersLimit",
    used: "vouchersUsed",
    isUnlimited: "isVouchersUnlimited",
  }),
  showcase: Object.freeze({
    limit: "showcaseLimit",
    used: "showcaseUsed",
    isUnlimited: "isShowcaseUnlimited",
  }),
});

// How each bucket is described to the vendor in a 403.
const BUCKET_LABELS = Object.freeze({
  subBrands: Object.freeze({ one: "outlet", many: "outlets", title: "Outlet/Sub-brand" }),
  franchises: Object.freeze({ one: "franchise", many: "franchises", title: "Franchise" }),
  vouchers: Object.freeze({ one: "voucher", many: "vouchers", title: "Voucher" }),
  showcase: Object.freeze({
    one: "showcase section",
    many: "showcase sections",
    title: "Showcase section",
  }),
});

// Conservative last resort. Deliberately stingy: if we cannot tell what a plan
// grants, grant almost nothing rather than leaking a paid feature for free.
const DEFAULT_ENTITLEMENTS = Object.freeze({
  subBrands: Object.freeze({ limit: 1, isUnlimited: false }),
  franchises: Object.freeze({ limit: 0, isUnlimited: false }),
  vouchers: Object.freeze({ limit: 0, isUnlimited: false }),
  showcase: Object.freeze({ limit: 0, isUnlimited: false }),
  dealPack: Object.freeze({ isEnabled: false }),
  prioritySupport: Object.freeze({ isEnabled: false }),
});

// What a brand is left with once its subscription expires or is cancelled:
// nothing new can be created, but existing rows are never touched.
const EXPIRED_ENTITLEMENTS = Object.freeze({
  subBrands: Object.freeze({ limit: 0, isUnlimited: false }),
  franchises: Object.freeze({ limit: 0, isUnlimited: false }),
  vouchers: Object.freeze({ limit: 0, isUnlimited: false }),
  showcase: Object.freeze({ limit: 0, isUnlimited: false }),
  dealPack: Object.freeze({ isEnabled: false }),
  prioritySupport: Object.freeze({ isEnabled: false }),
});

// Which entitlement keys are counted pools vs plain on/off flags.
// A metered bucket with `limit: 0` and `isUnlimited: false` means the feature is
// not in the plan at all, which is why no separate `isEnabled` flag is needed.
const METERED_ENTITLEMENTS = Object.freeze([
  "subBrands",
  "franchises",
  "vouchers",
  "showcase",
]);
// `dealPack` has no domain to gate yet; `prioritySupport` is informational.
const FLAG_ENTITLEMENTS = Object.freeze(["dealPack", "prioritySupport"]);

/**
 * Legacy bridge ONLY — maps the free-text `Subscription.features[].title` a
 * human typed onto a structured entitlement key, so the plans that predate
 * `Subscription.entitlements` keep working.
 *
 * This is the single place in the codebase allowed to parse display strings for
 * enforcement, and it is intentionally lossy: `Franchise: "Yes"` carries no
 * count, so it cannot produce a limit and falls through to
 * DEFAULT_ENTITLEMENTS. Set `entitlements` explicitly on every plan.
 */
const ENTITLEMENT_FEATURE_TITLES = Object.freeze({
  subBrands: Object.freeze([
    "sub brand",
    "sub brands",
    "sub-brand",
    "sub-brands",
    "subbrand",
    "subbrands",
    "outlet",
    "outlets",
  ]),
  franchises: Object.freeze(["franchise", "franchises"]),
  vouchers: Object.freeze(["voucher", "vouchers"]),
  dealPack: Object.freeze(["deal pack", "dealpack", "deal-pack"]),
  prioritySupport: Object.freeze(["priority support", "priority-support"]),
  showcase: Object.freeze(["showcase", "show case"]),
});

const UNLIMITED_TOKENS = Object.freeze([
  "unlimited",
  "infinite",
  "no limit",
  "unltd",
  "∞",
]);
const TRUTHY_TOKENS = Object.freeze(["yes", "true", "enabled", "included"]);
const FALSY_TOKENS = Object.freeze([
  "no",
  "false",
  "disabled",
  "none",
  "not included",
]);

// ---------------------------------------------------------------------------
// Config fallbacks — Setting.vendor.subscription overrides every one of these
// ---------------------------------------------------------------------------

const SUBSCRIPTION_DEFAULTS = Object.freeze({
  gstPercentage: 18,
  isGstInclusive: false, // false => GST is added on top of the plan price
  currency: "INR",
  currencySymbol: "₹",
  hsnSacCode: "998315", // SAC: other support services
  companyName: "Trydood",
  companyGstin: "",
  companyAddress: "",
  // Left blank on purpose. Until an admin fills this in we cannot prove the
  // supply is intra-state, so the tax falls back to a single IGST line.
  companyStateCode: "",
  companyState: "",
  allowVendorUpgrade: true,
  allowVendorDowngrade: false, // vendors cannot self-downgrade
  allowVendorRenewal: true,
  allowAdminDowngrade: true, // admins can, and may grandfather overflow
  allowAdminFreeGrant: true,
  gracePeriodDays: 0,
  // On by default. `PUT /settings/update` still turns it off per-platform if a
  // campaign has to be pulled, which is the switch that matters — an admin can
  // stop codes in one call without a deploy.
  isPromoCodeEnabled: true,
  // Reuse of a still-open Razorpay order instead of creating a duplicate.
  pendingOrderReuseMinutes: 15,
  expiryJobIntervalMinutes: 60,
  // Days before endDate on which a renewal reminder is sent.
  expiryReminderDays: Object.freeze([7, 3, 1]),
  reminderJobIntervalMinutes: 180,
  isEmailNotificationEnabled: true,
  // On by default: push costs nothing per message and is gated by whether FCM
  // credentials exist at all, so this is a kill switch rather than an opt-in.
  isPushNotificationEnabled: true,
  // Off by default, deliberately. WhatsApp Business charges per message and
  // every message type needs its own Meta-approved template — so this stays an
  // explicit opt-in, turned on once the templates are live.
  isWhatsAppNotificationEnabled: false,
});

/**
 * Upgrading ends the current plan immediately and starts the new one from that
 * date — the remaining days are forfeited, and the policy states so upfront.
 *
 * No proration is applied, but every forfeit is recorded (`forfeitedDays` /
 * `forfeitedValue` on the superseded Subscribed doc and on its history row) so
 * those vendors can be found later and compensated with credit or a goodwill
 * extension. See `GET /subscribeds/admin/forfeited`.
 */
const FORFEIT_POLICY = Object.freeze({
  RECORD_ONLY: "RECORD_ONLY",
});

// Order-summary row keys. The checkout page renders these in order and does no
// arithmetic of its own — see helpers/subscribeds/buildOrderSummary.js
const ORDER_SUMMARY_ROWS = Object.freeze({
  ORIGINAL_PRICE: "ORIGINAL_PRICE",
  DISCOUNT: "DISCOUNT",
  PROMO_DISCOUNT: "PROMO_DISCOUNT",
  BILL_VALUE: "BILL_VALUE",
  TAX: "TAX",
});

module.exports = {
  SUBSCRIBED_STATUS,
  SUBSCRIBED_TERMINAL_STATUSES,
  SUBSCRIPTION_ACTION,
  SUBSCRIPTION_SOURCE,
  PAYMENT_GATEWAYS,
  MANUAL_PAYMENT_MODES,
  DISCOUNT_TYPES,
  GST_TAX_TYPES,
  SUBSCRIPTION_HISTORY_ACTION,
  HISTORY_PERFORMED_BY,
  ENTITLEMENT_SOURCE,
  ENTITLEMENT_BUCKETS,
  BUCKET_BRAND_FIELDS,
  BUCKET_LABELS,
  FORFEIT_POLICY,
  DEFAULT_ENTITLEMENTS,
  EXPIRED_ENTITLEMENTS,
  METERED_ENTITLEMENTS,
  FLAG_ENTITLEMENTS,
  ENTITLEMENT_FEATURE_TITLES,
  UNLIMITED_TOKENS,
  TRUTHY_TOKENS,
  FALSY_TOKENS,
  SUBSCRIPTION_DEFAULTS,
  ORDER_SUMMARY_ROWS,
};
