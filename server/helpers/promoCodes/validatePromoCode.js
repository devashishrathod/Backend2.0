const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const Subscribed = require("../../models/Subscribed");
const {
  PROMO_USAGE_STATUS,
  PROMO_REJECTION,
  PROMO_AUDIENCE,
} = require("../../constants/promoCode");
const { SUBSCRIBED_STATUS } = require("../../constants/subscription");
const { evaluateVendorPromo } = require("./evaluateVendorPromo");
const { buildAudienceFilter } = require("./buildAudienceFilter");

/**
 * Resolve a **vendor subscription** promo code and compute what it is worth.
 *
 * Returns a verdict rather than throwing, so the preview endpoint can render a
 * disabled Apply button with a reason while order creation turns the same
 * verdict into a 422. Every rejection carries a specific message — a vendor
 * needs to know *why* a code did not work, not just that it did not.
 *
 * What a code decides now lives in `evaluateVendorPromo`, which the vendor promo
 * **listing** calls too; this file is the database half — find the code, count
 * what the per-brand gates need, hand both over. The customer side is split the
 * same way, and for the same reason: a listing holding its own copy of these
 * rules would offer a vendor a code that fails the moment they apply it.
 *
 * The discount applies to `taxableValue` — the price *after* the plan's own
 * discount — never to the list price. GST is then charged on what remains, so
 * the tax base stays correct.
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
  //
  // ⚠️ `isPublic` is not part of this lookup. It decides whether a code is
  // listed, never whether it is redeemable — a code sent to one brand has to
  // work when that brand types it.
  if (!promo) return { ok: false, reason: PROMO_REJECTION.NOT_FOUND };

  const context = { promo, subscription, action, taxableValue };

  /**
   * First pass with no counts — see the twin note in `validateCustomerPromoCode`.
   * Every gate but the two per-brand ones is decided from the document and this
   * checkout alone, so a rejection here is final and costs no query. ⚠️ The
   * zeros are the permissive reading, so this pass may only be trusted when it
   * says no.
   */
  const firstPass = evaluateVendorPromo(context);
  if (!firstPass.ok) return firstPass;

  const [priorSubscribedCount, brandUsageCount] = await Promise.all([
    promo.firstTimeOnly
      ? Subscribed.countDocuments({
          brandId: brand._id,
          status: { $ne: SUBSCRIBED_STATUS.PENDING },
          isDeleted: false,
        })
      : 0,
    // Per-brand cap counts the ledger, not `usedCount` — RESERVED rows count
    // too, so a vendor cannot hold two open orders against a single-use code.
    // Scoped by audience so customer claims on the same code are never counted.
    PromoCodeUsage.countDocuments({
      promoCodeId: promo._id,
      brandId: brand._id,
      audience: { $ne: PROMO_AUDIENCE.CUSTOMER },
      status: {
        $in: [PROMO_USAGE_STATUS.RESERVED, PROMO_USAGE_STATUS.CONSUMED],
      },
    }),
  ]);

  return evaluateVendorPromo({
    ...context,
    priorSubscribedCount,
    brandUsageCount,
  });
};
