const Subscribed = require("../../models/Subscribed");
const Subscription = require("../../models/Subscription");
const { SUBSCRIBED_STATUS } = require("../../constants/subscription");
const { resolveActorBrand, summarizeUsage } = require("../../helpers/brands");
const { resolveEntitlements } = require("../../helpers/subscriptions");
const {
  getActiveSubscription,
  daysRemaining,
  formatDuration,
  formatSubscriptionType,
} = require("../../helpers/subscribeds");

/**
 * A brand's subscription state as the vendor dashboard / admin panel needs it.
 *
 * Reports the live plan resolved from `status` + `endDate` rather than the
 * cached `brand.isSubscribed`, and returns the resolved entitlements next to
 * the actual usage so the UI can render "12 of 15 outlets used" without doing
 * its own lookups or arithmetic.
 *
 * `entitlementsSource` tells an admin whether the numbers being enforced come
 * from the plan's structured `entitlements` (DB) or were guessed from the
 * legacy free-text features (DERIVED / DEFAULT) — i.e. which plans still need
 * configuring properly.
 */
exports.getBrandSubscription = async (actor, payload = {}) => {
  const brand = await resolveActorBrand(actor, payload.brandId);
  const active = await getActiveSubscription(brand._id);

  const plan = active?.subscriptionId
    ? await Subscription.findById(active.subscriptionId).lean()
    : null;

  const resolved = plan ? resolveEntitlements(plan) : null;

  const [lastExpired, totalCount] = await Promise.all([
    active
      ? null
      : Subscribed.findOne({
          brandId: brand._id,
          status: { $ne: SUBSCRIBED_STATUS.PENDING },
          isDeleted: false,
        })
          .sort({ endDate: -1 })
          .lean(),
    Subscribed.countDocuments({ brandId: brand._id, isDeleted: false }),
  ]);

  return {
    brand: {
      _id: brand._id,
      brandName: brand.brandName,
      isSubscribed: Boolean(active),
    },
    isSubscribed: Boolean(active),
    subscription: active
      ? {
          _id: active._id,
          status: active.status,
          source: active.source,
          paymentMode: active.paymentMode || null,
          isFreeGrant: Boolean(active.isFreeGrant),
          startDate: active.startDate,
          endDate: active.endDate,
          daysRemaining: daysRemaining(active.endDate),
          durationLabel: formatDuration(
            active.durationInDays,
            active.durationInYears,
          ),
          paidAmount: active.paidAmount,
          pricing: active.pricing,
          transactionId: active.transactionId,
          plan: plan
            ? {
                _id: plan._id,
                name: plan.name,
                type: plan.type,
                typeLabel: formatSubscriptionType(plan.type),
                price: plan.price,
                features: plan.features,
                benefits: plan.benefits,
              }
            : null,
        }
      : null,
    // Present when nothing is live, so the panel can say "expired on ...".
    lastSubscription: lastExpired
      ? {
          _id: lastExpired._id,
          status: lastExpired.status,
          endDate: lastExpired.endDate,
          subscriptionId: lastExpired.subscriptionId,
        }
      : null,
    entitlements: resolved?.entitlements || null,
    entitlementsSource: resolved?.source || null,
    entitlementWarnings: resolved?.warnings || [],
    // Every metered pool in one uniform shape — outlets, franchises, vouchers
    // and showcase sections.
    usage: {
      ...summarizeUsage(brand),
      syncedAt: brand.entitlementsSyncedAt || null,
    },
    totalSubscriptions: totalCount,
  };
};
