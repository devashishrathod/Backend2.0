const mongoose = require("mongoose");
const { GST_TAX_TYPES } = require("../constants/subscription");
const { VOUCHER_DISCOUNT_TYPES } = require("../constants/voucher");
const { PROMO_APPLIES_TO } = require("../constants/promoCode");
const {
  CUSTOMER_CURRENCY_DEFAULTS,
  CUSTOMER_TAX_DEFAULTS,
} = require("../constants/customer");

/**
 * Frozen snapshot of how one voucher claim was priced.
 *
 * The customer-side twin of `pricingSchema`, and it exists for the same reason:
 * an invoice must be regenerable and a dispute reconstructable **exactly**, long
 * after an admin has changed the convenience-fee slab, edited the voucher's
 * offers, deleted the promo code, or switched GST on.
 *
 * Every number here is produced by `helpers/vouchers/calculateVoucherPricing.js`
 * and rounded to 2 decimals. Nothing else may compute these.
 *
 * ### Why so many fields are copied rather than referenced
 *
 * `offerTitle`, `discountType`, `promoCode`, the slab configuration — all of it
 * could be looked up through an id. None of it is, because every one of those
 * sources is **editable after the fact**:
 *
 *  - Offers live embedded in `VoucherVersion.offers`; publishing a new version
 *    changes what `offerId` resolves to.
 *  - A promo code can be deactivated, re-scoped, or soft-deleted.
 *  - The fee slab is admin config with no history at all.
 *
 * A claim priced in September must still read the same in March. So the claim
 * carries its own copy and never joins for it.
 *
 * ### This block is a cross-phase contract
 *
 * Phase 1B writes it, 1C reads it for history and invoices, S1 refunds against
 * it, and S2 settles from it. Fields are added here, never repurposed — a field
 * whose meaning changed would silently rewrite the past.
 */
const voucherPricingSchema = new mongoose.Schema(
  {
    currency: { type: String, default: CUSTOMER_CURRENCY_DEFAULTS.currency },

    // ---------- what the customer typed ----------
    // The raw bill at the counter, before anything is applied. Both the offer
    // and the convenience fee are computed from THIS, never from a discounted
    // figure — see `calculateConvenienceFee`.
    billAmount: { type: Number, default: 0 },

    // ---------- the voucher offer ----------
    // Null when the bill was below every offer's minimum, or the voucher has no
    // offers. That is a priced outcome, not an error: the customer pays the bill.
    offerId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Copied, because offers are embedded in a version that can be republished.
    offerTitle: { type: String, default: null },
    offerDiscountType: {
      type: String,
      enum: [...Object.values(VOUCHER_DISCOUNT_TYPES), null],
      default: null,
    },
    offerDiscountValue: { type: Number, default: 0 },
    offerMinBillAmount: { type: Number, default: 0 },
    offerMaxDiscountAmount: { type: Number, default: null },
    offerDiscount: { type: Number, default: 0 },

    // ---------- the promo code ----------
    // The code string, not just its id: the row has to stay readable after the
    // code is deleted, and the string is what the customer will quote in a
    // dispute.
    promoCode: { type: String, default: null },
    promoCodeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // What the discount came off — the bill after the offer, or our own fee.
    promoAppliesTo: {
      type: String,
      enum: [...Object.values(PROMO_APPLIES_TO), null],
      default: null,
    },
    // The base as it stood at pricing time, so the clamp can be re-checked
    // rather than re-derived from figures that have since moved.
    promoBase: { type: Number, default: 0 },
    promoDiscount: { type: Number, default: 0 },
    /**
     * Who funded the discount, split once and frozen.
     *
     * `vendorPromoCost + platformPromoCost === promoDiscount`, always. Frozen
     * because a settlement computed weeks later must not re-read `costBearing`
     * off a promo code an admin has since edited — that would rewrite money
     * already shown to the vendor.
     */
    vendorPromoCost: { type: Number, default: 0 },
    platformPromoCost: { type: Number, default: 0 },

    // ---------- the vendor's supply ----------
    // billAmount − offerDiscount. GST on this is the vendor's own concern, not
    // ours: Trydood is not selling the meal.
    netBill: { type: Number, default: 0 },

    // ---------- Trydood's fee ----------
    convenienceFee: { type: Number, default: 0 },
    // The slab configuration in force at the time. Kept so the fee can be
    // explained — "why ₹15?" — years later, when the slab has changed twice.
    feeSlabSize: { type: Number, default: 0 },
    feePerSlab: { type: Number, default: 0 },
    feeMaxFee: { type: Number, default: null },

    /**
     * ---------- tax ----------
     *
     * GST applies to the **convenience fee only** — that is Trydood's service
     * income. The vendor's supply is the vendor's own tax matter.
     *
     * Off by default (`CUSTOMER_TAX_DEFAULTS.isGstEnabled === false`), and while
     * it is off `taxType` stays null so an invoice renderer prints no tax rows
     * at all rather than a row of zeroes.
     *
     * `isGstInclusive` defaults to **true**: the slab amounts are what the
     * customer pays in total and the tax is back-calculated out of them, so
     * switching the master switch on does not silently raise the price.
     *
     * ⚠️ Place of supply for a B2C service is the **outlet's** state — that is
     * where the service is consumed. It is recorded here even while GST is off,
     * because the day it is switched on, every historical claim needs to have
     * been unambiguous about it.
     */
    isGstEnabled: {
      type: Boolean,
      default: CUSTOMER_TAX_DEFAULTS.isGstEnabled,
    },
    gstPercentage: { type: Number, default: 0 },
    isGstInclusive: {
      type: Boolean,
      default: CUSTOMER_TAX_DEFAULTS.isGstInclusive,
    },
    taxType: {
      type: String,
      enum: [...Object.values(GST_TAX_TYPES), null],
      default: null,
    },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    // The tax added ON TOP of the fee. Zero when GST is inclusive, because then
    // it is already inside `convenienceFee`.
    taxOnTop: { type: Number, default: 0 },
    sacCode: { type: String, default: null },
    placeOfSupplyStateCode: { type: String, default: null },
    placeOfSupplyState: { type: String, default: null },

    // ---------- what actually gets charged ----------
    // netBill − promoDiscount + convenienceFee + taxOnTop.
    totalPayable: { type: Number, default: 0 },
    // The integer paise figure sent to Razorpay, and the value the verify step
    // re-derives and compares against to catch tampering.
    amountInPaise: { type: Number, default: 0 },
    // offerDiscount + promoDiscount. The one number the customer cares about.
    youSaved: { type: Number, default: 0 },

    // ---------- what the vendor is owed ----------
    // netBill − vendorPromoCost − commissionAmount. Frozen at claim time.
    vendorPayable: { type: Number, default: 0 },
    /**
     * 0 today, and stored anyway.
     *
     * Reading the live rate at settlement time would let a rate change
     * retroactively dock money from claims already collected and already shown
     * to the vendor. Adding the field on the day commission is switched on
     * would leave every prior claim with no recorded rate, which is the same
     * problem wearing a different hat.
     */
    commissionPercent: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    /**
     * GST on the commission, from the same switches as the fee's `gstAmount`.
     * Zero twice over today — the rate is 0 and GST is off — and frozen for the
     * same reason as the rate above.
     */
    commissionTax: { type: Number, default: 0 },
    /**
     * What the settlement actually deducts: `commissionAmount`, plus
     * `commissionTax` **only** when that tax sits on top rather than inside.
     *
     * Stored rather than re-derived so the settlement, the ledger and the
     * statement cannot disagree about it once `isGstInclusive` is flipped.
     */
    commissionDeduction: { type: Number, default: 0 },
  },
  { _id: false },
);

module.exports = { voucherPricingSchema };
