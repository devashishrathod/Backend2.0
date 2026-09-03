const Brand = require("../../models/Brand");
const Subscribed = require("../../models/Subscribed");
const {
  SUBSCRIBED_STATUS,
  SUBSCRIPTION_HISTORY_ACTION,
} = require("../../constants/subscription");
const { throwError } = require("../../utils");
const {
  getActiveSubscription,
  syncBrandSubscriptionState,
  recordSubscribedHistory,
} = require("../../helpers/subscribeds");
const Subscription = require("../../models/Subscription");
const {
  notifySubscriptionCancelled,
} = require("../../helpers/notifications");
const { summarizeUsage } = require("../../helpers/brands");

/**
 * Admin revokes a brand's live subscription before its end date.
 *
 * Ends the plan immediately (CANCELLED, endDate = now) and strips the brand's
 * limits so nothing new can be created. Existing outlets, franchises, vouchers
 * and showcase entries are left completely untouched — revoking a plan is not a
 * data deletion, and the vendor gets everything back the moment they resubscribe.
 */
exports.adminCancelSubscription = async (actor, payload) => {
  const { brandId, reason } = payload;

  const brand = await Brand.findById(brandId);
  if (!brand || brand.isDeleted) throwError(404, "Brand not found!");

  const active = await getActiveSubscription(brand._id);
  if (!active) {
    throwError(422, "This brand has no active subscription to cancel.");
  }

  const now = new Date();
  await Subscribed.updateOne(
    { _id: active._id },
    {
      $set: {
        status: SUBSCRIBED_STATUS.CANCELLED,
        endDate: now,
        cancelledAt: now,
        cancelReason: reason,
        isActive: false,
        isExpired: true,
      },
    },
  );

  const sync = await syncBrandSubscriptionState(brand._id);

  await recordSubscribedHistory({
    brandId: brand._id,
    subscribedId: active._id,
    transactionId: active.transactionId,
    action: SUBSCRIPTION_HISTORY_ACTION.CANCELLED,
    performedBy: actor.userId,
    role: actor.role,
    fromSubscriptionId: active.subscriptionId,
    amount: active.pricing?.totalPayable ?? active.price,
    startDate: active.startDate,
    endDate: now,
    reason,
    snapshot: {
      cancelledFromEndDate: active.endDate,
      entitlements: sync.entitlements,
    },
  });

  const subscription = await Subscription.findById(active.subscriptionId)
    .select("name")
    .lean();
  // After the state change commits — a notification must never undo it.
  await notifySubscriptionCancelled({
    subscribed: active,
    subscription,
    reason,
  });

  const cancelled = await Subscribed.findById(active._id).lean();
  return {
    subscribed: cancelled,
    isSubscribed: sync.isSubscribed,
    // All limits go to zero; usage is deliberately untouched, because
    // cancelling a plan never removes what the brand has already built.
    limits: summarizeUsage(await Brand.findById(brand._id).lean()),
    usage: sync.usage,
  };
};
