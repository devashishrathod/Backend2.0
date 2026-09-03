const mongoose = require("mongoose");
const {
  brandField,
  customerField,
  userField,
  transactionField,
  subscribedField,
  subscriptionField,
  voucherClaimField,
} = require("./validObjectId");
const {
  PROMO_USAGE_STATUS,
  PROMO_AUDIENCE,
} = require("../constants/promoCode");

/**
 * One brand's claim on one promo code — the discount ledger.
 *
 * Three-step lifecycle so an abandoned checkout cannot burn a single-use code:
 *   RESERVED at order creation -> CONSUMED on payment verification
 *                              -> RELEASED if the order fails or goes stale
 *
 * `perBrandUsageLimit` is enforced by counting RESERVED + CONSUMED rows here,
 * not by trusting `PromoCode.usedCount`, which is only a fast counter.
 */
const promoCodeUsageSchema = new mongoose.Schema(
  {
    promoCodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PromoCode",
      required: true,
      index: true,
    },
    code: { type: String, required: true, uppercase: true, trim: true },

    /**
     * Which checkout this claim came from.
     *
     * The per-owner cap is counted from this ledger, so it has to be scoped:
     * counting a customer's rows against a brand's limit — or the reverse —
     * would be nonsense. Every query on this collection filters by audience.
     */
    audience: {
      type: String,
      enum: Object.values(PROMO_AUDIENCE),
      default: PROMO_AUDIENCE.VENDOR,
      required: true,
      index: true,
    },

    /**
     * The owner of the claim: `brandId` on the vendor side, `customerId` on the
     * customer side. Exactly one is set.
     *
     * `brandId` was `required: true`; it no longer can be, because a customer
     * claim has no brand of its own. The audience discriminates instead — and
     * the vendor-side queries keep working unchanged because they already
     * filter on `brandId`.
     */
    brandId: { ...brandField, index: true },
    customerId: { ...customerField, index: true },
    userId: userField,

    // -- vendor side --
    subscriptionId: subscriptionField,
    subscribedId: subscribedField,
    // -- customer side --
    voucherClaimId: voucherClaimField,

    transactionId: transactionField,
    status: {
      type: String,
      enum: Object.values(PROMO_USAGE_STATUS),
      default: PROMO_USAGE_STATUS.RESERVED,
      required: true,
    },
    discountAmount: { type: Number, default: 0 },

    /**
     * How the discount was funded, frozen at claim time.
     *
     * `vendorCost + platformCost === discountAmount`, always. Split once here so
     * a settlement never has to re-derive it from a promo code that may since
     * have been edited.
     */
    vendorCost: { type: Number, default: 0 },
    platformCost: { type: Number, default: 0 },
    reservedAt: { type: Date, default: Date.now },
    consumedAt: { type: Date },
    releasedAt: { type: Date },
    releaseReason: { type: String, trim: true },
  },
  { timestamps: true, versionKey: false },
);

// Per-brand cap check, and the reclaim sweep for stale reservations.
promoCodeUsageSchema.index({ promoCodeId: 1, brandId: 1, status: 1 });
// The customer-side twin of the cap check.
promoCodeUsageSchema.index({ promoCodeId: 1, customerId: 1, status: 1 });
// The campaign report groups by audience; without this it scans the other
// side's rows on every run.
promoCodeUsageSchema.index({ audience: 1, createdAt: -1 });
promoCodeUsageSchema.index({ status: 1, reservedAt: 1 });
// One transaction can hold at most one promo claim.
promoCodeUsageSchema.index(
  { transactionId: 1 },
  { unique: true, sparse: true },
);

module.exports = mongoose.model("PromoCodeUsage", promoCodeUsageSchema);
