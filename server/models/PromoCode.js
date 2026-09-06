const mongoose = require("mongoose");
const {
  userField,
  subscriptionField,
  voucherField,
  brandField,
  categoryField,
} = require("./validObjectId");
const {
  PROMO_DISCOUNT_TYPES,
  PROMO_APPLICABLE_ACTIONS,
  PROMO_CODE_LIMITS,
  PROMO_AUDIENCE,
  PROMO_APPLIES_TO,
  PROMO_COST_BEARING_MODE,
} = require("../constants/promoCode");

/**
 * A subscription promo code.
 *
 * `usedCount` is only ever moved by an atomic conditional update (the same
 * filter-plus-increment pattern the outlet pools use), so a limited code cannot
 * be oversold under concurrent checkouts. The authoritative per-brand history
 * lives in `PromoCodeUsage` — `usedCount` is a fast counter, not the ledger.
 */
const promoCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      minlength: PROMO_CODE_LIMITS.MIN_CODE_LENGTH,
      maxlength: PROMO_CODE_LIMITS.MAX_CODE_LENGTH,
    },
    description: {
      type: String,
      trim: true,
      maxlength: PROMO_CODE_LIMITS.MAX_DESCRIPTION_LENGTH,
    },

    // ---------- discount ----------
    discountType: {
      type: String,
      enum: Object.values(PROMO_DISCOUNT_TYPES),
      required: true,
    },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    discountAmount: { type: Number, default: 0, min: 0 },
    // Caps a PERCENT code, e.g. "20% off up to ₹1,000".
    maxDiscountAmount: { type: Number, min: 0 },
    // Checked against the *plan-discounted* subtotal, not the list price.
    minOrderValue: { type: Number, default: 0, min: 0 },

    /**
     * Who this code is for.
     *
     * ⚠️ A schema default applies on **write only**. Codes created before this
     * field existed carry no `audience`, so `{ audience: "VENDOR" }` matches
     * none of them and would silently kill every live code. Every query goes
     * through `helpers/promoCodes/buildAudienceFilter.js`, which turns VENDOR
     * into `$ne: CUSTOMER` for exactly that reason; the migration backfills the
     * field.
     */
    audience: {
      type: String,
      enum: Object.values(PROMO_AUDIENCE),
      default: PROMO_AUDIENCE.VENDOR,
      required: true,
      index: true,
    },

    // ---------- scoping (empty / false means "no restriction") ----------

    // -- vendor audience --
    subscriptionIds: { type: [subscriptionField], default: [] },
    applicableActions: {
      type: [{ type: String, enum: Object.values(PROMO_APPLICABLE_ACTIONS) }],
      default: [],
    },
    // Only brands with no prior non-PENDING Subscribed document.
    firstTimeOnly: { type: Boolean, default: false },

    // -- customer audience --
    voucherIds: { type: [voucherField], default: [] },
    brandIds: { type: [brandField], default: [] },
    categoryIds: { type: [categoryField], default: [] },
    // Checked against the customer's own ledger rows, not against usedCount.
    perCustomerUsageLimit: { type: Number, default: 1, min: 1 },
    // The customer equivalent of firstTimeOnly: no prior settled claim.
    firstOrderOnly: { type: Boolean, default: false },
    // Checked against the raw bill, before any offer — the number the customer
    // typed, which is what "minimum bill" means to them.
    minBillAmount: { type: Number, default: 0, min: 0 },

    /**
     * What the discount comes off. Clamped to that base, so a ₹50 code against
     * a ₹10 convenience fee takes ₹10 rather than eating ₹40 out of the bill.
     */
    appliesTo: {
      type: String,
      enum: Object.values(PROMO_APPLIES_TO),
      default: PROMO_APPLIES_TO.NET_BILL,
    },

    /**
     * Who funds the discount.
     *
     * The vendor is paid `netBill` minus their share, so this changes what a
     * settlement owes. Frozen onto each claim at checkout — editing a live code
     * must never retroactively change what a vendor was already told they would
     * be paid.
     *
     * VENDOR and SHARED require a non-empty `brandIds`; without it the code
     * would deduct from whichever brand the customer happened to visit. Enforced
     * in `services/promoCodes/createPromoCode.js` → `assertCoherent`.
     */
    costBearing: {
      mode: {
        type: String,
        enum: Object.values(PROMO_COST_BEARING_MODE),
        default: PROMO_COST_BEARING_MODE.PLATFORM,
      },
      vendorPercent: { type: Number, default: 0, min: 0, max: 100 },
    },

    // ---------- window ----------
    validFrom: { type: Date },
    validTill: { type: Date },

    // ---------- caps ----------
    // null / absent = unlimited across the platform.
    totalUsageLimit: { type: Number, min: 1 },
    perBrandUsageLimit: { type: Number, default: 1, min: 1 },
    // Reserved + consumed. Moved atomically; reconciled from PromoCodeUsage.
    usedCount: { type: Number, default: 0, min: 0 },

    createdBy: userField,
    updatedBy: userField,
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

promoCodeSchema.index({ isActive: 1, isDeleted: 1, validTill: 1 });
// The admin listing and the campaign report both scope by audience — without
// this the two reports scan each other's rows.
promoCodeSchema.index({ audience: 1, isDeleted: 1, createdAt: -1 });
// Multikey — powers the `stats.promoCodes` count on the category listing.
promoCodeSchema.index({ categoryIds: 1, isDeleted: 1 });

module.exports = mongoose.model("PromoCode", promoCodeSchema);
