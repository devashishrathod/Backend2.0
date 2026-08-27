const { throwError } = require("../../utils");
const { VOUCHER_DISCOUNT_TYPES } = require("../../constants/voucher");
const { calculateConvenienceFee } = require("./calculateConvenienceFee");

const round2 = (n) => Number(Number(n).toFixed(2));

/**
 * What the customer actually pays, broken into the rows a checkout screen shows.
 *
 * Returned as one `pricing` object so the client never does arithmetic of its
 * own — the same reasoning as `helpers/subscribeds/buildOrderSummary.js`.
 */
const buildPricing = ({ billAmount, discountAmount, convenienceFee }) => {
  const bill = round2(billAmount);
  const discount = round2(discountAmount);
  const fee = round2(convenienceFee);

  return {
    billAmount: bill,
    discountAmount: discount,
    // Customer-side promo codes are not wired up yet — PromoCode currently only
    // serves vendor subscription checkout. The row exists so the shape does not
    // change for clients when it is.
    promoDiscount: 0,
    convenienceFee: fee,
    payableAmount: round2(bill - discount + fee),
    totalSavings: discount,
  };
};

/**
 * Price a voucher against a bill.
 *
 * **No eligible offer is a valid outcome, not an error.** This used to throw
 * `"No eligible offer found for this bill amount."` whenever the bill sat below
 * every offer's minimum, which reads to the customer as though their bill were
 * malformed. It now returns a priced result with no offer applied: they simply
 * pay the bill, and no discount, promo or convenience fee is charged.
 *
 * @param {object}   args
 * @param {Array}    args.offers            offers on the published version
 * @param {number}   args.billAmount
 * @param {object}   [args.convenienceFeeConfig]  from `getCustomerConfig()`
 */
exports.calculateVoucherOffer = ({
  offers = [],
  billAmount,
  convenienceFeeConfig = {},
}) => {
  const amount = Number(billAmount);

  // Still a hard error: a non-positive bill is malformed input, not a business
  // case with a sensible answer.
  if (!Number.isFinite(amount) || amount <= 0) {
    throwError(400, "Valid bill amount is required.");
  }

  const now = new Date();

  const eligibleOffers = (Array.isArray(offers) ? offers : [])
    .filter((offer) => {
      if (!offer) return false;

      if (offer.isDeleted === true || offer.isActive === false) {
        return false;
      }

      if (offer.startAt && new Date(offer.startAt) > now) {
        return false;
      }

      if (offer.endAt && new Date(offer.endAt) <= now) {
        return false;
      }

      const minAmount = Number(offer.minBillAmount || 0);
      return amount >= minAmount;
    })
    .map((offer) => {
      const minAmount = Number(offer.minBillAmount || 0);
      let discountAmount = 0;

      if (offer.discountType === VOUCHER_DISCOUNT_TYPES.PERCENTAGE) {
        const percentage = Number(offer.discountValue);
        discountAmount = (amount * percentage) / 100;
        if (
          offer.maxDiscountAmount !== undefined &&
          offer.maxDiscountAmount !== null
        ) {
          discountAmount = Math.min(
            discountAmount,
            Number(offer.maxDiscountAmount),
          );
        }
      }

      // FIXED is in VOUCHER_DISCOUNT_TYPES and passes validation, but nothing
      // ever calculated it — such an offer scored 0, got filtered out of the
      // eligible list, and the customer saw "No eligible offer found for this
      // bill amount" as though their bill were the problem. It means the same
      // thing as FLAT, so it is treated as an alias rather than removed, which
      // would strand the offers already stored with it.
      if (
        offer.discountType === VOUCHER_DISCOUNT_TYPES.FLAT ||
        offer.discountType === VOUCHER_DISCOUNT_TYPES.FIXED
      ) {
        discountAmount = Number(offer.discountValue);
      }

      discountAmount = Math.min(discountAmount, amount);

      return {
        offerId: offer._id,
        title: offer.title || null,
        discountType: offer.discountType,
        discountValue: offer.discountValue,
        minBillAmount: minAmount,
        maxDiscountAmount: offer.maxDiscountAmount ?? null,
        usageType: offer.usageType ?? null,
        discountApplicableOn: offer.discountApplicableOn ?? null,
        discountAmount: round2(discountAmount),
        finalAmount: round2(amount - discountAmount),
      };
    })
    .filter((offer) => offer.discountAmount > 0);

  // ── Nothing applies ──────────────────────────────────────────────────────
  // Either the voucher carries no offers at all, or the bill is below every
  // minimum. Same answer in both cases: pay the bill, nothing added.
  if (!eligibleOffers.length) {
    return {
      billAmount: round2(amount),
      offerApplied: false,
      selectedOffer: null,
      eligibleOffers: [],
      pricing: buildPricing({
        billAmount: amount,
        discountAmount: 0,
        convenienceFee: 0,
      }),
    };
  }

  /**
   * Best discount wins.
   *
   * If two offers give same discount,
   * higher minimum purchase tier wins.
   */
  eligibleOffers.sort((a, b) => {
    if (b.discountAmount !== a.discountAmount) {
      return b.discountAmount - a.discountAmount;
    }
    return b.minBillAmount - a.minBillAmount;
  });

  const selectedOffer = eligibleOffers[0];

  // Charged on the original bill, so the fee does not move when a different
  // offer is picked — see calculateConvenienceFee.
  const convenienceFee = calculateConvenienceFee(amount, convenienceFeeConfig);

  return {
    billAmount: round2(amount),
    offerApplied: true,
    selectedOffer,
    eligibleOffers,
    pricing: buildPricing({
      billAmount: amount,
      discountAmount: selectedOffer.discountAmount,
      convenienceFee,
    }),
  };
};
