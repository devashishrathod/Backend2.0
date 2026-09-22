const { PROMO_REJECTION } = require("../../constants/promoCode");
const { assertPromoWindowAndCaps } = require("./assertPromoWindowAndCaps");

/**
 * The two gates that need a chosen plan.
 *
 * Split out of the main sequence only to keep that sequence readable — it is
 * still one gate, and it still runs in place.
 *
 * @returns {string|null} the rejection, or null when the plan is in scope
 */
const planRejection = (promo, subscription, action) => {
  // An empty scope list means "no restriction".
  if (promo.subscriptionIds?.length) {
    const allowed = promo.subscriptionIds.some(
      (id) => String(id) === String(subscription?._id),
    );
    if (!allowed) return PROMO_REJECTION.PLAN_NOT_ELIGIBLE;
  }

  if (
    promo.applicableActions?.length &&
    !promo.applicableActions.includes(action)
  ) {
    return PROMO_REJECTION.ACTION_NOT_ELIGIBLE;
  }

  return null;
};

/**
 * Decide a **vendor subscription** promo code against one checkout, without
 * touching the database.
 *
 * The customer twin is `evaluateCustomerPromo`, and the reasoning is the same:
 * two callers ask this question — the checkout that resolves one typed code
 * (`validatePromoCode`) and the listing that decides a whole page at once
 * (`services/promoCodes/getVendorPromoCodes.js`) — and a listing with its own
 * copy of these rules would eventually offer a vendor a code that fails the
 * moment they apply it.
 *
 * `priorSubscribedCount` and `brandUsageCount` are inputs rather than lookups so
 * the listing can count a whole page in one aggregation. ⚠️ Both default to `0`,
 * the permissive answer, so a caller that forgets to count fails open — every
 * caller passes them, and the money suite pins both gates.
 *
 * The discount applies to `taxableValue` — the price *after* the plan's own
 * discount — never to the list price, so GST stays charged on what remains.
 *
 * ### `hasCheckoutContext: false`
 *
 * The listing is also opened with no plan chosen — a vendor browsing what is on
 * offer before deciding. The minimum order value, the plan scope and the action
 * scope all need a plan, so in that mode they are **skipped** rather than
 * answered with stand-in values: `taxableValue: 0` against a `minOrderValue`
 * would reject every code with a minimum, and an invented `action` would reject
 * the ones scoped to a different one. `discount` comes back `null` — "not
 * priced", not "worth nothing" — and the gates that stand on their own (the
 * window, the platform cap, first-time-only, the per-brand cap) still decide.
 *
 * @param {object} args
 * @param {object} args.promo          the PromoCode document
 * @param {object} [args.subscription] the plan being bought
 * @param {string} [args.action]       NEW | RENEW | UPGRADE | DOWNGRADE
 * @param {number} [args.taxableValue] plan price minus the plan discount
 * @param {number} [args.priorSubscribedCount] non-PENDING plans this brand has had
 * @param {number} [args.brandUsageCount]      RESERVED + CONSUMED rows it holds
 * @param {boolean} [args.hasCheckoutContext]  false when no plan was named
 * @returns {{ok: boolean, reason?: string, promoCode?: object, discount?: number}}
 */
exports.evaluateVendorPromo = ({
  promo,
  subscription,
  action,
  taxableValue = 0,
  priorSubscribedCount = 0,
  brandUsageCount = 0,
  hasCheckoutContext = true,
}) => {
  if (!promo) return { ok: false, reason: PROMO_REJECTION.NOT_FOUND };

  const reject = (reason) => ({ ok: false, reason, promoCode: promo });

  // ---------- shared gates: live, in window, platform cap, worth ----------
  const verdict = assertPromoWindowAndCaps({
    promo,
    base: hasCheckoutContext ? taxableValue : 0,
    // Only meaningful against a real plan price. Passed as `undefined` with no
    // plan, so a `0` base cannot trip a minimum the vendor has not been shown.
    minBase: hasCheckoutContext ? promo.minOrderValue : undefined,
    minReason: PROMO_REJECTION.MIN_ORDER_VALUE,
  });
  if (!verdict.ok) return verdict;

  // ---------- vendor-specific gates ----------
  if (hasCheckoutContext) {
    const outOfScope = planRejection(promo, subscription, action);
    if (outOfScope) return reject(outOfScope);
  }

  if (promo.firstTimeOnly && priorSubscribedCount > 0) {
    return reject(PROMO_REJECTION.FIRST_TIME_ONLY);
  }

  if (brandUsageCount >= (promo.perBrandUsageLimit ?? 1)) {
    return reject(PROMO_REJECTION.BRAND_LIMIT_REACHED);
  }

  return hasCheckoutContext ? verdict : { ...verdict, discount: null };
};
