const mongoose = require("mongoose");
const { DISCOUNT_TYPES, GST_TAX_TYPES } = require("../constants/subscription");

/**
 * Frozen snapshot of how one amount was arrived at.
 *
 * Stored on both `Transaction` and `Subscribed` so an invoice can always be
 * regenerated and any dispute reconstructed exactly — even after the plan's
 * price, the discount, or the GST rate has since been changed by an admin.
 *
 * Every number here is produced by `helpers/subscribeds/calculatePricing.js`
 * and rounded to 2 decimals. Nothing else may compute these.
 */
const pricingSchema = new mongoose.Schema(
  {
    currency: { type: String, default: "INR" },

    // ---------- what the plan costs before anything is applied ----------
    listPrice: { type: Number, default: 0 },

    // ---------- plan-level discount ----------
    discountType: {
      type: String,
      enum: Object.values(DISCOUNT_TYPES),
      default: DISCOUNT_TYPES.PERCENT,
    },
    discountPercent: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },

    // ---------- promo code ----------
    // Applied to the already plan-discounted subtotal, never to the list price,
    // so `taxableValue` below is what GST is actually charged on. Null on an
    // order placed without a code.
    promoCode: { type: String, default: null },
    promoDiscount: { type: Number, default: 0 },

    // ---------- tax ----------
    // The GST-bearing amount: listPrice - discountAmount - promoDiscount.
    taxableValue: { type: Number, default: 0 },
    gstPercentage: { type: Number, default: 0 },
    isGstInclusive: { type: Boolean, default: false },
    taxType: {
      type: String,
      enum: Object.values(GST_TAX_TYPES),
      default: GST_TAX_TYPES.IGST,
    },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    hsnSacCode: { type: String },
    placeOfSupplyStateCode: { type: String },
    placeOfSupplyState: { type: String },

    // ---------- what actually gets charged ----------
    totalPayable: { type: Number, default: 0 },
    // The integer paise figure sent to Razorpay, and the value the verify step
    // re-derives and compares against to catch tampering.
    amountInPaise: { type: Number, default: 0 },
    youSaved: { type: Number, default: 0 },
  },
  { _id: false },
);

module.exports = { pricingSchema };
