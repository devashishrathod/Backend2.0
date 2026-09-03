const { GST_TAX_TYPES } = require("../../constants/subscription");
const { VOUCHER_DISCOUNT_TYPES } = require("../../constants/voucher");
const { PROMO_APPLIES_TO } = require("../../constants/promoCode");
const {
  CUSTOMER_CURRENCY_DEFAULTS,
} = require("../../constants/customer");
const { round2 } = require("../subscribeds/calculatePricing");
const { calculateConvenienceFee } = require("../voucherOffers/calculateConvenienceFee");

/**
 * What one voucher offer is worth against a bill.
 *
 * Exported because two callers need the **same** answer: `resolveClaimOffer`
 * ranks offers by it, and the pricing below charges by it. Computed twice by two
 * functions is how a customer ends up shown one discount and charged another.
 *
 * @param {object} offer  an embedded VoucherVersion offer
 * @param {number} billAmount
 * @returns {number} rupees, never more than the bill
 */
exports.computeOfferDiscount = (offer, billAmount) => {
  const amount = Number(billAmount) || 0;
  if (!offer || amount <= 0) return 0;

  let discount = 0;

  if (offer.discountType === VOUCHER_DISCOUNT_TYPES.PERCENTAGE) {
    discount = (amount * (Number(offer.discountValue) || 0)) / 100;
    if (offer.maxDiscountAmount !== undefined && offer.maxDiscountAmount !== null) {
      discount = Math.min(discount, Number(offer.maxDiscountAmount));
    }
  }

  // FIXED is in VOUCHER_DISCOUNT_TYPES and passes validation, but nothing ever
  // calculated it — such an offer scored 0 and was filtered out as ineligible,
  // which the customer saw as "no offer applies to your bill". It means the same
  // thing as FLAT, so it is an alias rather than a removal, which would strand
  // the offers already stored with it.
  if (
    offer.discountType === VOUCHER_DISCOUNT_TYPES.FLAT ||
    offer.discountType === VOUCHER_DISCOUNT_TYPES.FIXED
  ) {
    discount = Number(offer.discountValue) || 0;
  }

  // Never more than the bill: a ₹500 flat offer on a ₹300 bill is worth ₹300,
  // and anything else would make the vendor pay the customer to eat.
  return round2(Math.max(0, Math.min(discount, amount)));
};

/**
 * The **only** place a voucher claim's price is decided.
 *
 * Pure: no database, no config lookup, no clock. Everything it needs is passed
 * in, which is what makes the whole thing testable against a table of cases
 * rather than against a seeded database.
 *
 * ```
 * netBill        = billAmount − offerDiscount
 * convenienceFee = ceil(billAmount / slabSize) × feePerSlab      ← ORIGINAL bill
 * promoDiscount  = clamped to its own base (netBill or the fee)
 * taxOnTop       = GST on the fee, and only when GST is enabled
 * totalPayable   = netBill − promoDiscount + convenienceFee + taxOnTop
 * vendorPayable  = netBill − vendorPromoCost − commissionAmount
 * youSaved       = offerDiscount + promoDiscount
 * ```
 *
 * ### The fee is charged on the original bill
 *
 * Not on the discounted one. A fee that moved every time a different offer
 * applied would read as arbitrary, and an offer-comparison list would need its
 * own fee on every row instead of one figure for the whole checkout.
 *
 * ### GST applies to the fee, not to the meal
 *
 * The convenience fee is Trydood's service income. `netBill` is the vendor's
 * supply and their own tax matter — we are not selling the meal, and charging
 * GST on it here would be collecting tax on someone else's sale.
 *
 * Off by default. While off, `taxType` stays null so an invoice prints no tax
 * rows at all rather than a row of zeroes.
 *
 * ### Rounding
 *
 * Every intermediate is `round2`-ed as it is produced, and the components are
 * defined so they sum exactly: `cgst + sgst === gstAmount`, and
 * `vendorPromoCost + platformPromoCost === promoDiscount`. The remainder always
 * goes to one named side rather than being left to floating point.
 *
 * @param {object}  args
 * @param {number}  args.billAmount
 * @param {object}  [args.offer]          the resolved offer, or null
 * @param {object}  [args.promo]          verdict from `validateCustomerPromoCode`
 * @param {object}  [args.promoCost]      `{ vendorCost, platformCost }` from `splitPromoCost`
 * @param {object}  args.config           `getCustomerConfig()`
 * @param {object}  [args.placeOfSupply]  `{ stateCode, state }` — the OUTLET's
 * @returns {object} a `voucherPricingSchema`-shaped block
 */
exports.calculateVoucherPricing = ({
  billAmount,
  offer = null,
  promo = null,
  promoCost = null,
  config = {},
  placeOfSupply = {},
}) => {
  const bill = round2(billAmount);

  const feeConfig = config.convenienceFee || {};
  const taxConfig = config.tax || {};

  // ---------- the voucher offer ----------
  const offerDiscount = exports.computeOfferDiscount(offer, bill);
  const offerApplied = Boolean(offer) && offerDiscount > 0;
  const netBill = round2(bill - offerDiscount);

  // ---------- Trydood's fee ----------
  // With no offer the customer is paying their bill at full price. Charging a
  // platform fee on top of that means they pay MORE than they would have
  // without Trydood, so it is off unless an admin turned it on.
  const chargeFee = offerApplied || feeConfig.chargeWhenNoOffer;
  const convenienceFee = chargeFee
    ? calculateConvenienceFee(bill, feeConfig)
    : 0;

  // ---------- the promo code ----------
  //
  // Already clamped to its base by the validator; clamped again here because
  // this function is the one that must be right on its own. A caller that
  // forgets to pass the verdict through, or passes a stale one, must not be able
  // to drive the payable negative.
  const promoApplied = Boolean(promo?.ok && promo.discount > 0);
  const appliesTo = promoApplied
    ? promo.appliesTo || PROMO_APPLIES_TO.NET_BILL
    : null;
  const promoBase =
    appliesTo === PROMO_APPLIES_TO.CONVENIENCE_FEE ? convenienceFee : netBill;
  const promoDiscount = promoApplied
    ? round2(Math.max(0, Math.min(promo.discount, promoBase)))
    : 0;

  const vendorPromoCost = round2(promoCost?.vendorCost ?? 0);
  // The platform takes the remainder rather than its own rounded share, so the
  // two always sum to exactly the discount given.
  const platformPromoCost = round2(promoDiscount - vendorPromoCost);

  // ---------- tax ----------
  //
  // On the fee AFTER any promo that discounted the fee. Tax follows the
  // consideration actually received: a promo that takes a ₹10 fee to ₹0 leaves
  // nothing to tax, and charging GST on the pre-discount figure would collect
  // tax on money nobody paid.
  const taxableFee = round2(
    convenienceFee -
      (appliesTo === PROMO_APPLIES_TO.CONVENIENCE_FEE ? promoDiscount : 0),
  );

  const isGstEnabled = Boolean(taxConfig.isGstEnabled);
  const gstPercentage = isGstEnabled ? Number(taxConfig.gstPercentage) || 0 : 0;
  const isGstInclusive = Boolean(taxConfig.isGstInclusive);

  let gstAmount = 0;
  let taxOnTop = 0;
  if (isGstEnabled && gstPercentage > 0 && taxableFee > 0) {
    if (isGstInclusive) {
      // The slab amount already contains the tax. Back it out so switching the
      // master switch on does not silently raise what the customer pays.
      const net = round2(taxableFee / (1 + gstPercentage / 100));
      gstAmount = round2(taxableFee - net);
      taxOnTop = 0;
    } else {
      gstAmount = round2((taxableFee * gstPercentage) / 100);
      taxOnTop = gstAmount;
    }
  }

  /**
   * Place of supply for a B2C service is where it is **consumed** — the outlet's
   * state. Recorded even while GST is off, because the day it is switched on,
   * every historical claim needs to have been unambiguous about it.
   *
   * With no state on record we cannot prove an intra-state supply, so IGST is
   * the safe answer — the same rule the vendor side applies.
   */
  const sellerStateCode = String(config.companyStateCode || "").trim();
  const sellerState = String(config.companyState || "").trim().toLowerCase();
  const outletStateCode = placeOfSupply.stateCode
    ? String(placeOfSupply.stateCode).trim()
    : null;
  const outletState = String(placeOfSupply.state || "").trim().toLowerCase();

  /**
   * Codes first, names as a fallback — the same order the vendor side uses.
   *
   * The fallback is not academic here: an outlet's state comes from its
   * `Location`, which stores a **name** and no 2-digit GST code at all. Matching
   * on codes alone would find nothing to compare and bill every claim as
   * inter-state IGST, including one in the seller's own state.
   *
   * With neither available we cannot prove an intra-state supply, so IGST stands
   * as the safe answer.
   */
  const isIntraState =
    outletStateCode && sellerStateCode
      ? outletStateCode === sellerStateCode
      : Boolean(outletState && sellerState && outletState === sellerState);

  const taxType = !isGstEnabled
    ? null
    : isIntraState
      ? GST_TAX_TYPES.CGST_SGST
      : GST_TAX_TYPES.IGST;

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (taxType === GST_TAX_TYPES.CGST_SGST) {
    cgst = round2(gstAmount / 2);
    // Any half-paise remainder goes to SGST so cgst + sgst === gstAmount.
    sgst = round2(gstAmount - cgst);
  } else if (taxType === GST_TAX_TYPES.IGST) {
    igst = gstAmount;
  }

  // ---------- what the customer pays ----------
  const totalPayable = round2(
    netBill - promoDiscount + convenienceFee + taxOnTop,
  );

  // ---------- what the vendor is owed ----------
  const commissionPercent = Number(config.settlement?.commissionPercent) || 0;
  const commissionAmount = round2((netBill * commissionPercent) / 100);

  /**
   * GST on the commission, from the **same three switches** the convenience fee
   * above uses — not a second set of rules.
   *
   * Commission is a service we supply to the vendor, so when GST is on it
   * attracts the same tax as the fee we charge the customer. Deriving it here
   * rather than hardcoding a zero is the whole point: `Settlement.commissionTax`
   * existed as a field with `commissionTax: 0` written into `computeTotals`, the
   * same shape `chargebackAdjustment: 0` had before it turned out to be a real
   * hole. At today's `commissionPercent: 0` **and** `isGstEnabled: false` this is
   * zero twice over, so nothing changes now — and the day either is switched on,
   * the tax follows on its own instead of waiting to be noticed.
   *
   * ⚠️ Frozen onto the claim, like `commissionPercent`. A rate changed next month
   * must not re-price a sale that already happened.
   */
  let commissionTax = 0;
  if (isGstEnabled && gstPercentage > 0 && commissionAmount > 0) {
    if (isGstInclusive) {
      // Already inside the commission. Back it out; the vendor is still deducted
      // exactly the rate they were quoted.
      const net = round2(commissionAmount / (1 + gstPercentage / 100));
      commissionTax = round2(commissionAmount - net);
    } else {
      commissionTax = round2((commissionAmount * gstPercentage) / 100);
    }
  }

  /**
   * What actually comes off the vendor.
   *
   * Inclusive: the tax is already inside `commissionAmount`, so deducting it
   * again would charge them twice. On top: it is genuinely extra, and a vendor
   * deducted only the bare commission would leave us paying their GST.
   */
  const commissionDeduction = round2(
    commissionAmount + (isGstInclusive ? 0 : commissionTax),
  );
  const vendorPayable = round2(netBill - vendorPromoCost - commissionDeduction);

  return {
    currency: config.currency || CUSTOMER_CURRENCY_DEFAULTS.currency,

    billAmount: bill,

    offerId: offerApplied ? offer._id || null : null,
    offerTitle: offerApplied ? offer.title || null : null,
    offerDiscountType: offerApplied ? offer.discountType || null : null,
    offerDiscountValue: offerApplied ? Number(offer.discountValue) || 0 : 0,
    offerMinBillAmount: offerApplied ? Number(offer.minBillAmount) || 0 : 0,
    offerMaxDiscountAmount: offerApplied
      ? (offer.maxDiscountAmount ?? null)
      : null,
    offerDiscount,

    promoCode: promoApplied ? promo.promoCode?.code || null : null,
    promoCodeId: promoApplied ? promo.promoCode?._id || null : null,
    promoAppliesTo: appliesTo,
    promoBase: promoApplied ? round2(promoBase) : 0,
    promoDiscount,
    vendorPromoCost,
    platformPromoCost,

    netBill,

    convenienceFee,
    feeSlabSize: chargeFee ? Number(feeConfig.slabSize) || 0 : 0,
    feePerSlab: chargeFee ? Number(feeConfig.feePerSlab) || 0 : 0,
    feeMaxFee: chargeFee ? (feeConfig.maxFee ?? null) : null,

    isGstEnabled,
    gstPercentage,
    isGstInclusive,
    taxType,
    cgst,
    sgst,
    igst,
    gstAmount,
    taxOnTop,
    sacCode: isGstEnabled ? taxConfig.sacCode || null : null,
    placeOfSupplyStateCode: outletStateCode,
    placeOfSupplyState: placeOfSupply.state || null,

    totalPayable,
    // The integer paise figure sent to Razorpay, and the value the verify step
    // re-derives and compares against to catch tampering.
    amountInPaise: Math.round(totalPayable * 100),
    youSaved: round2(offerDiscount + promoDiscount),

    vendorPayable,
    commissionPercent,
    commissionAmount,
    commissionTax,
    // What the settlement actually deducts — commission, plus its tax only when
    // that tax sits on top. Stored rather than re-derived so the settlement and
    // the ledger cannot disagree about it months later.
    commissionDeduction,
  };
};
