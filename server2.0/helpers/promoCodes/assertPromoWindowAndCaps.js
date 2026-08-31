const {
  PROMO_DISCOUNT_TYPES,
  PROMO_REJECTION,
} = require("../../constants/promoCode");
const { round2 } = require("../subscribeds/calculatePricing");

/**
 * The audience-agnostic half of promo validation.
 *
 * Everything here is true of a code regardless of who is using it: is it live,
 * is it inside its window, has the platform-wide cap run out, and what is it
 * worth against a given base. The audience-specific gates — which plan, which
 * voucher, which brand, whose usage limit — live in the vendor and customer
 * validators that call this.
 *
 * Split out so those two can never drift on the shared rules. A discount that
 * is capped differently at one checkout than the other is a pricing bug that
 * would be invisible until someone compared two invoices.
 *
 * Returns a verdict rather than throwing: the preview endpoints render the
 * rejection inline with a disabled Apply button, and order creation turns the
 * same verdict into a 422.
 *
 * @param {object} args
 * @param {object} args.promo       the PromoCode document
 * @param {number} args.base        the amount the discount is subtracted from
 * @param {number} [args.minBase]   minimum the base must reach, if any
 * @param {string} [args.minReason] rejection to use when `minBase` is not met
 * @returns {{ ok: boolean, reason?: string, promoCode?: object, discount?: number }}
 */
exports.assertPromoWindowAndCaps = ({ promo, base, minBase, minReason }) => {
  if (!promo) return { ok: false, reason: PROMO_REJECTION.NOT_FOUND };
  if (!promo.isActive) return { ok: false, reason: PROMO_REJECTION.INACTIVE };

  const now = new Date();
  if (promo.validFrom && now < promo.validFrom) {
    return { ok: false, reason: PROMO_REJECTION.NOT_STARTED, promoCode: promo };
  }
  if (promo.validTill && now > promo.validTill) {
    return { ok: false, reason: PROMO_REJECTION.EXPIRED, promoCode: promo };
  }

  if (minBase && base < minBase) {
    return {
      ok: false,
      reason: minReason || PROMO_REJECTION.MIN_ORDER_VALUE,
      promoCode: promo,
    };
  }

  if (promo.totalUsageLimit && promo.usedCount >= promo.totalUsageLimit) {
    return {
      ok: false,
      reason: PROMO_REJECTION.TOTAL_LIMIT_REACHED,
      promoCode: promo,
    };
  }

  // ---------- worth ----------
  let discount =
    promo.discountType === PROMO_DISCOUNT_TYPES.PERCENT
      ? round2((base * (promo.discountPercent || 0)) / 100)
      : round2(promo.discountAmount || 0);

  if (promo.maxDiscountAmount) {
    discount = Math.min(discount, round2(promo.maxDiscountAmount));
  }

  // Clamped to the base it applies to, never to the order total. A ₹50 code
  // against a ₹10 convenience fee is worth ₹10 — letting it exceed the base
  // would eat into something it was never meant to discount, and on the
  // customer side could drive the payable to zero or below.
  discount = Math.min(discount, round2(base));
  discount = Math.max(0, discount);

  return { ok: true, promoCode: promo, discount };
};
