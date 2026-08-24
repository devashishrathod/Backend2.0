const mongoose = require("mongoose");
const {
  brandField,
  userField,
  transactionField,
  subscribedField,
  subscriptionField,
} = require("./validObjectId");
const { PROMO_USAGE_STATUS } = require("../constants/promoCode");

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
    brandId: { ...brandField, required: true, index: true },
    userId: userField,
    subscriptionId: subscriptionField,
    transactionId: transactionField,
    subscribedId: subscribedField,
    status: {
      type: String,
      enum: Object.values(PROMO_USAGE_STATUS),
      default: PROMO_USAGE_STATUS.RESERVED,
      required: true,
    },
    discountAmount: { type: Number, default: 0 },
    reservedAt: { type: Date, default: Date.now },
    consumedAt: { type: Date },
    releasedAt: { type: Date },
    releaseReason: { type: String, trim: true },
  },
  { timestamps: true, versionKey: false },
);

// Per-brand cap check, and the reclaim sweep for stale reservations.
promoCodeUsageSchema.index({ promoCodeId: 1, brandId: 1, status: 1 });
promoCodeUsageSchema.index({ status: 1, reservedAt: 1 });
// One transaction can hold at most one promo claim.
promoCodeUsageSchema.index(
  { transactionId: 1 },
  { unique: true, sparse: true },
);

module.exports = mongoose.model("PromoCodeUsage", promoCodeUsageSchema);
