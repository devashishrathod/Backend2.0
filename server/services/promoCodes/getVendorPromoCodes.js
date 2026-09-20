const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const Subscribed = require("../../models/Subscribed");
const Subscription = require("../../models/Subscription");
const { pagination, throwError } = require("../../utils");
const {
  PROMO_AUDIENCE,
  PROMO_USAGE_STATUS,
  PROMO_REJECTION,
  PROMO_CODE_LIMITS,
} = require("../../constants/promoCode");
const { SUBSCRIBED_STATUS } = require("../../constants/subscription");
const {
  buildListedPromoFilter,
  evaluateVendorPromo,
  shapePromoForList,
  resolvePromoScopeNames,
  pickScopeNames,
} = require("../../helpers/promoCodes");
const { buildCheckoutPreview } = require("../../helpers/subscribeds");
const { resolveActorBrand } = require("../../helpers/brands");
const { getSubscriptionConfig } = require("../../helpers/settings");

/**
 * The plan the vendor is about to buy, if they named one.
 *
 * ⚠️ Through `buildCheckoutPreview`, not priced here. That helper is what
 * decides the **action** — a code restricted to renewals has to know this is a
 * renewal, and only the brand's current subscription says so — and what the
 * taxable value is after the plan's own discount. Working either out separately
 * would drift from the checkout page the vendor is looking at.
 *
 * ### ⚠️ This read can write, and that is the correct behaviour
 *
 * `buildCheckoutPreview` → `getActiveSubscription` runs with `heal: true`, so a
 * `Subscribed` row still claiming ACTIVE past its `endDate` is expired on the
 * spot. A listing writing anything is worth knowing about, and the helper even
 * offers `heal: false` "for read-only callers that must not write" — but taking
 * that option here would be wrong.
 *
 * The healed state is what `resolveSubscriptionAction` reads. Skipping the
 * repair leaves the stale row looking live, the action comes back RENEW when
 * the honest answer is NEW, and a code scoped to `["NEW"]` is then reported as
 * unusable to the one vendor it was written for — while the checkout a click
 * later heals the row and accepts it. The listing and the checkout would
 * disagree, which is the single thing this whole design exists to prevent.
 */
const resolvePlanContext = async (brand, subscriptionId, actor) => {
  const subscription = await Subscription.findOne({
    _id: subscriptionId,
    isDeleted: false,
  });
  if (!subscription) throwError(404, "Subscription plan not found!");

  const preview = await buildCheckoutPreview(brand, subscription, actor);

  return {
    subscription,
    action: preview.action,
    taxableValue: preview.pricing.taxableValue,
  };
};

/** What the list was priced against, echoed back. */
const contextEcho = (context) =>
  context
    ? {
        subscriptionId: context.subscription._id,
        planName: context.subscription.name,
        action: context.action,
        taxableValue: context.taxableValue,
      }
    : null;

/**
 * The promo codes a vendor may pick from when buying a plan.
 *
 * The customer twin is `getCustomerPromoCodes`, and it works the same way:
 * name a plan (`subscriptionId`) and every row says whether it applies **to
 * that purchase**, why not when it does not, and what it saves; name none and
 * it is a catalogue with the gates that stand without a plan (already used,
 * first-purchase-only) and no invented prices.
 *
 * ⚠️ Every rule comes from `evaluateVendorPromo` — the same function
 * `validatePromoCode` runs at subscription checkout. The two per-brand gates
 * are counted for the whole page at once rather than per row.
 *
 * ### Whose codes
 *
 * `resolveActorBrand` decides the brand: a vendor gets their own and may not
 * name another's, an admin must name one. Without it an admin previewing a
 * purchase for a brand would get a usage count of nobody's, and every capped
 * code would come back as available.
 *
 * @param {object} actor  { userId, role, brandId } built from the request
 * @param {object} query  validated query
 */
exports.getVendorPromoCodes = async (actor, query = {}) => {
  const brand = await resolveActorBrand(actor, query.brandId);

  const page = query.page ? Number(query.page) : 1;
  const limit = query.limit
    ? Number(query.limit)
    : PROMO_CODE_LIMITS.DEFAULT_LIST_LIMIT;

  const config = await getSubscriptionConfig();

  const empty = {
    isEnabled: Boolean(config.isPromoCodeEnabled),
    context: null,
    total: 0,
    totalPages: 0,
    page,
    limit,
    data: [],
  };

  if (!config.isPromoCodeEnabled) {
    return { ...empty, message: PROMO_REJECTION.DISABLED };
  }

  const context = query.subscriptionId
    ? await resolvePlanContext(brand, query.subscriptionId, actor)
    : null;

  const pipeline = [
    { $match: buildListedPromoFilter(PROMO_AUDIENCE.VENDOR) },
    { $sort: { createdAt: -1 } },
  ];

  const result = await pagination(
    PromoCode,
    pipeline,
    page,
    limit,
    "promo code",
    { allowEmpty: true },
  );

  const promos = result.data;
  if (!promos.length) {
    return { ...empty, ...result, context: contextEcho(context) };
  }

  const [usageRows, priorSubscribedCount, scopeNames] = await Promise.all([
    // RESERVED counts as used, so a brand holding an open order against a
    // single-use code is not offered it again.
    PromoCodeUsage.aggregate([
      {
        $match: {
          promoCodeId: { $in: promos.map((promo) => promo._id) },
          brandId: brand._id,
          // `$ne: CUSTOMER`, never `$eq: VENDOR` — rows written before the
          // field existed are vendor rows, and missing them would hand a brand
          // a code it has already spent.
          audience: { $ne: PROMO_AUDIENCE.CUSTOMER },
          status: {
            $in: [PROMO_USAGE_STATUS.RESERVED, PROMO_USAGE_STATUS.CONSUMED],
          },
        },
      },
      { $group: { _id: "$promoCodeId", count: { $sum: 1 } } },
    ]),
    promos.some((promo) => promo.firstTimeOnly)
      ? Subscribed.countDocuments({
          brandId: brand._id,
          status: { $ne: SUBSCRIBED_STATUS.PENDING },
          isDeleted: false,
        })
      : 0,
    resolvePromoScopeNames(promos),
  ]);

  const usedByPromo = new Map(
    usageRows.map((row) => [String(row._id), row.count]),
  );

  const data = promos.map((promo) => {
    const used = usedByPromo.get(String(promo._id)) || 0;
    const verdict = evaluateVendorPromo({
      promo,
      subscription: context?.subscription,
      action: context?.action,
      taxableValue: context?.taxableValue,
      priorSubscribedCount,
      brandUsageCount: used,
      hasCheckoutContext: Boolean(context),
    });

    return shapePromoForList(promo, {
      audience: PROMO_AUDIENCE.VENDOR,
      scopeNames: pickScopeNames(promo, scopeNames),
      used,
      isApplicable: verdict.ok,
      reason: verdict.reason,
      savings:
        verdict.ok && context
          ? { discount: verdict.discount, base: context.taxableValue }
          : null,
    });
  });

  // Usable first, biggest saving first inside that — see the twin note in the
  // customer listing for why the unusable ones are still shown.
  data.sort((a, b) => {
    if (a.isApplicable !== b.isApplicable) return a.isApplicable ? -1 : 1;
    return (b.savings?.discount ?? 0) - (a.savings?.discount ?? 0);
  });

  return {
    isEnabled: true,
    context: contextEcho(context),
    ...result,
    data,
  };
};
