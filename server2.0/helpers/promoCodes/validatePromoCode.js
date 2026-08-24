const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const Subscribed = require("../../models/Subscribed");
const {
  PROMO_DISCOUNT_TYPES,
  PROMO_USAGE_STATUS,
  PROMO_REJECTION,
} = require("../../constants/promoCode");
const { SUBSCRIBED_STATUS } = require("../../constants/subscription");
const { round2 } = require("../subscribeds/calculatePricing");

/**
 * Resolve a promo code and compute what it is worth on this order.
 *
 * Returns a verdict rather than throwing, so the preview endpoint can render a
 * disabled Apply button with a reason while order creation turns the same
 * verdict into a 422. Every rejection carries a specific message — a vendor
 * needs to know *why* a code did not work, not just that it did not.
 *
 * The discount applies to `taxableValue` — the price *after* the plan's own
 * discount — never to the list price. GST is then charged on what remains, so
 * the tax base stays correct.
 *
 * @param {object}  args
 * @param {string}  args.code
 * @param {object}  args.brand
 * @param {object}  args.subscription
 * @param {string}  args.action        NEW | RENEW | UPGRADE | DOWNGRADE
 * @param {number}  args.taxableValue  plan price minus the plan discount
 * @param {boolean} args.isEnabled     Setting.vendor.subscription.isPromoCodeEnabled
 * @returns {Promise<{ok: boolean, reason?: string, promoCode?: object, discount?: number}>}
 */
exports.validatePromoCode = async ({
  code,
  brand,
  subscription,
  action,
  taxableValue,
  isEnabled,
}) => {
  if (!code) return { ok: false, reason: null };
  if (!isEnabled) return { ok: false, reason: PROMO_REJECTION.DISABLED };

  const normalized = String(code).trim().toUpperCase();
  const promo = await PromoCode.findOne({
    code: normalized,
    isDeleted: false,
  });

  if (!promo) return { ok: false, reason: PROMO_REJECTION.NOT_FOUND };
  if (!promo.isActive) return { ok: false, reason: PROMO_REJECTION.INACTIVE };

  const now = new Date();
  if (promo.validFrom && now < promo.validFrom) {
    return { ok: false, reason: PROMO_REJECTION.NOT_STARTED, promoCode: promo };
  }
  if (promo.validTill && now > promo.validTill) {
    return { ok: false, reason: PROMO_REJECTION.EXPIRED, promoCode: promo };
  }

  // An empty scope list means "no restriction".
  if (promo.subscriptionIds?.length) {
    const allowed = promo.subscriptionIds.some(
      (id) => String(id) === String(subscription._id),
    );
    if (!allowed) {
      return {
        ok: false,
        reason: PROMO_REJECTION.PLAN_NOT_ELIGIBLE,
        promoCode: promo,
      };
    }
  }

  if (promo.applicableActions?.length && !promo.applicableActions.includes(action)) {
    return {
      ok: false,
      reason: PROMO_REJECTION.ACTION_NOT_ELIGIBLE,
      promoCode: promo,
    };
  }

  if (promo.firstTimeOnly) {
    const prior = await Subscribed.countDocuments({
      brandId: brand._id,
      status: { $ne: SUBSCRIBED_STATUS.PENDING },
      isDeleted: false,
    });
    if (prior > 0) {
      return {
        ok: false,
        reason: PROMO_REJECTION.FIRST_TIME_ONLY,
        promoCode: promo,
      };
    }
  }

  // Checked against the already-discounted subtotal, matching where the promo
  // discount is actually applied.
  if (promo.minOrderValue && taxableValue < promo.minOrderValue) {
    return {
      ok: false,
      reason: PROMO_REJECTION.MIN_ORDER_VALUE,
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

  // Per-brand cap counts the ledger, not `usedCount` — RESERVED rows count too,
  // so a vendor cannot hold two open orders against a single-use code.
  const brandUses = await PromoCodeUsage.countDocuments({
    promoCodeId: promo._id,
    brandId: brand._id,
    status: {
      $in: [PROMO_USAGE_STATUS.RESERVED, PROMO_USAGE_STATUS.CONSUMED],
    },
  });
  if (brandUses >= (promo.perBrandUsageLimit ?? 1)) {
    return {
      ok: false,
      reason: PROMO_REJECTION.BRAND_LIMIT_REACHED,
      promoCode: promo,
    };
  }

  // ---------- worth ----------
  let discount =
    promo.discountType === PROMO_DISCOUNT_TYPES.PERCENT
      ? round2((taxableValue * (promo.discountPercent || 0)) / 100)
      : round2(promo.discountAmount || 0);

  if (promo.maxDiscountAmount) {
    discount = Math.min(discount, round2(promo.maxDiscountAmount));
  }
  // Never let a promo push the order negative.
  discount = Math.min(discount, taxableValue);

  return { ok: true, promoCode: promo, discount };
};
