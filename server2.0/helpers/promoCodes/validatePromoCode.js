const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const Subscribed = require("../../models/Subscribed");
const {
  PROMO_USAGE_STATUS,
  PROMO_REJECTION,
  PROMO_AUDIENCE,
} = require("../../constants/promoCode");
const { SUBSCRIBED_STATUS } = require("../../constants/subscription");
const { assertPromoWindowAndCaps } = require("./assertPromoWindowAndCaps");
const { buildAudienceFilter } = require("./buildAudienceFilter");

/**
 * Resolve a **vendor subscription** promo code and compute what it is worth.
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
 * The window, the platform-wide cap and the discount arithmetic now live in
 * `assertPromoWindowAndCaps`, shared with the customer validator so the two can
 * never disagree on what a code is worth.
 *
 * **Audience isolation.** The lookup is scoped so a customer voucher code can
 * never be redeemed at subscription checkout. Why that scope is `$ne: CUSTOMER`
 * rather than `$eq: VENDOR` is explained once in `buildAudienceFilter`, which
 * the admin listing and the campaign report use too.
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
    ...buildAudienceFilter(PROMO_AUDIENCE.VENDOR),
  });

  // A customer-audience code reaching here is reported exactly like a code that
  // does not exist. Saying "this code is not for you" would confirm it exists.
  if (!promo) return { ok: false, reason: PROMO_REJECTION.NOT_FOUND };

  // ---------- shared gates: live, in window, platform cap, worth ----------
  const verdict = assertPromoWindowAndCaps({
    promo,
    base: taxableValue,
    minBase: promo.minOrderValue,
    minReason: PROMO_REJECTION.MIN_ORDER_VALUE,
  });
  if (!verdict.ok) return verdict;

  // ---------- vendor-specific gates ----------

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

  if (
    promo.applicableActions?.length &&
    !promo.applicableActions.includes(action)
  ) {
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

  // Per-brand cap counts the ledger, not `usedCount` — RESERVED rows count too,
  // so a vendor cannot hold two open orders against a single-use code. Scoped by
  // audience so customer claims on the same code are never counted here.
  const brandUses = await PromoCodeUsage.countDocuments({
    promoCodeId: promo._id,
    brandId: brand._id,
    audience: { $ne: PROMO_AUDIENCE.CUSTOMER },
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

  return verdict;
};
