const mongoose = require("mongoose");
const { userField, subscriptionField } = require("./validObjectId");
const {
  PROMO_DISCOUNT_TYPES,
  PROMO_APPLICABLE_ACTIONS,
  PROMO_CODE_LIMITS,
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

    // ---------- scoping (empty / false means "no restriction") ----------
    subscriptionIds: { type: [subscriptionField], default: [] },
    applicableActions: {
      type: [{ type: String, enum: Object.values(PROMO_APPLICABLE_ACTIONS) }],
      default: [],
    },
    // Only brands with no prior non-PENDING Subscribed document.
    firstTimeOnly: { type: Boolean, default: false },

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

module.exports = mongoose.model("PromoCode", promoCodeSchema);
