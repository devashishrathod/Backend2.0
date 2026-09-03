const {
  DISCOUNT_TYPES,
  GST_TAX_TYPES,
} = require("../../constants/subscription");

// Money is rounded to paise at every step so the stored breakdown always adds
// up exactly to what Razorpay was asked to charge. `+ Number.EPSILON` keeps
// binary-float values like 899.8199999 from rounding down.
const round2 = (value) => {
  const n = Number(value) || 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
};

/**
 * Decide whether the supply is intra-state (CGST + SGST) or inter-state (IGST).
 *
 * The brand's GSTIN is authoritative — its first two digits are the state code.
 * Without a GSTIN we compare state names, and if we still cannot prove the
 * states match we charge IGST rather than guessing a split.
 */
const resolvePlaceOfSupply = (buyer = {}, config = {}) => {
  const buyerStateCode = String(buyer.gstin || "")
    .trim()
    .slice(0, 2);
  const sellerStateCode = String(config.companyStateCode || "").trim();

  if (buyerStateCode && sellerStateCode) {
    return {
      taxType:
        buyerStateCode === sellerStateCode
          ? GST_TAX_TYPES.CGST_SGST
          : GST_TAX_TYPES.IGST,
      stateCode: buyerStateCode,
      state: buyer.state || "",
    };
  }

  const buyerState = String(buyer.state || "")
    .trim()
    .toLowerCase();
  const sellerState = String(config.companyState || "")
    .trim()
    .toLowerCase();

  return {
    taxType:
      buyerState && sellerState && buyerState === sellerState
        ? GST_TAX_TYPES.CGST_SGST
        : GST_TAX_TYPES.IGST,
    stateCode: buyerStateCode || "",
    state: buyer.state || "",
  };
};

/**
 * The one and only place a payable amount is computed.
 *
 * Preview, order creation, payment verification and the invoice all call this
 * with the same inputs, which is what guarantees the number a vendor is shown
 * at checkout is the number that reaches Razorpay and the number printed on the
 * invoice. Pure — no DB, no I/O.
 *
 * @param {object}  args
 * @param {object}  args.subscription   the plan (price, discountType, ...)
 * @param {object}  args.config         getSubscriptionConfig() output
 * @param {object} [args.buyer]         { gstin, state } for place-of-supply
 * @param {string} [args.promoCode]     the code being applied, for the record
 * @param {number} [args.promoDiscount] rupee value from validatePromoCode
 * @returns {object} pricing block, shaped exactly like models/pricingSchema.js
 */
exports.calculatePricing = ({
  subscription,
  config,
  buyer = {},
  promoCode = null,
  promoDiscount = 0,
} = {}) => {
  const listPrice = round2(subscription?.price);
  const discountType = subscription?.discountType || DISCOUNT_TYPES.PERCENT;
  const discountPercent = Number(subscription?.discountPercent) || 0;

  // A percent plan derives its rupee discount; a flat plan takes it verbatim.
  // Either way the discount can never exceed the list price.
  let discountAmount =
    discountType === DISCOUNT_TYPES.PERCENT
      ? round2((listPrice * discountPercent) / 100)
      : round2(subscription?.discountAmount);
  discountAmount = Math.min(discountAmount, listPrice);

  // A promo code discount stacks on top of the plan's own discount and applies
  // to the already-discounted subtotal, never to the list price — so GST is
  // charged on what the vendor actually pays for. The rupee value is computed by
  // `helpers/promoCodes/validatePromoCode.js`; this only records and applies it,
  // clamped so the two discounts together can never exceed the list price.
  const appliedPromoDiscount = Math.max(
    0,
    Math.min(round2(promoDiscount), round2(listPrice - discountAmount)),
  );

  const gstPercentage = Number(config?.gstPercentage) || 0;
  const isGstInclusive = Boolean(config?.isGstInclusive);
  const { taxType, stateCode, state } = resolvePlaceOfSupply(buyer, config);

  let taxableValue;
  let gstAmount;
  let totalPayable;

  if (isGstInclusive) {
    // The plan price already contains GST — back it out of the discounted
    // gross so the vendor is charged exactly the advertised figure.
    const gross = round2(listPrice - discountAmount - appliedPromoDiscount);
    taxableValue = round2(gross / (1 + gstPercentage / 100));
    gstAmount = round2(gross - taxableValue);
    totalPayable = gross;
  } else {
    taxableValue = round2(listPrice - discountAmount - appliedPromoDiscount);
    gstAmount = round2((taxableValue * gstPercentage) / 100);
    totalPayable = round2(taxableValue + gstAmount);
  }

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (taxType === GST_TAX_TYPES.CGST_SGST) {
    cgst = round2(gstAmount / 2);
    // Give any half-paise remainder to SGST so cgst + sgst === gstAmount.
    sgst = round2(gstAmount - cgst);
  } else {
    igst = gstAmount;
  }

  return {
    currency: config?.currency || "INR",
    listPrice,
    discountType,
    discountPercent,
    discountAmount,
    promoCode: promoCode || null,
    promoDiscount: appliedPromoDiscount,
    taxableValue,
    gstPercentage,
    isGstInclusive,
    taxType,
    cgst,
    sgst,
    igst,
    gstAmount,
    hsnSacCode: config?.hsnSacCode,
    placeOfSupplyStateCode: stateCode,
    placeOfSupplyState: state,
    totalPayable,
    // Integer paise. This is what Razorpay is asked for and what the verify
    // step compares the captured amount against.
    amountInPaise: Math.round(totalPayable * 100),
    youSaved: round2(discountAmount + appliedPromoDiscount),
  };
};

exports.round2 = round2;
