const Brand = require("../../models/Brand");
const Subscribed = require("../../models/Subscribed");
const Subscription = require("../../models/Subscription");
const { SUBSCRIBED_STATUS } = require("../../constants/subscription");
const { applyPlanEntitlements } = require("../brands/applyPlanEntitlements");

/**
 * Recompute a brand's cached subscription state from its Subscribed documents.
 *
 * `Brand.isSubscribed` / `Brand.subscribedId` are a denormalized cache, never
 * the source of truth — that is the Subscribed doc's `status` + `endDate`. This
 * is the single writer of that cache, and it also re-applies the plan's
 * entitlements so limits and subscription state can never disagree.
 *
 * Called after every activation, admin grant, plan change, cancellation, and by
 * the expiry job. Idempotent, so calling it twice is harmless.
 *
 * `subscribedId` keeps pointing at the most recent plan even once it lapses, so
 * the existing brand/voucher lookups still have something to join against; only
 * `isSubscribed` flips to false.
 */
exports.syncBrandSubscriptionState = async (brandId) => {
  const live = await Subscribed.findOne({
    brandId,
    status: SUBSCRIBED_STATUS.ACTIVE,
    endDate: { $gt: new Date() },
    isDeleted: false,
  })
    .sort({ endDate: -1 })
    .lean();

  if (!live) {
    // No live plan: strip the limits but leave every existing outlet alone.
    const result = await applyPlanEntitlements(brandId, null);
    await Brand.updateOne({ _id: brandId }, { $set: { isSubscribed: false } });
    return {
      isSubscribed: false,
      subscribed: null,
      subscription: null,
      ...result,
    };
  }

  const subscription = await Subscription.findById(live.subscriptionId).lean();
  const result = await applyPlanEntitlements(brandId, subscription);

  await Brand.updateOne(
    { _id: brandId },
    { $set: { isSubscribed: true, subscribedId: live._id } },
  );

  return {
    isSubscribed: true,
    subscribed: live,
    subscription,
    ...result,
  };
};
