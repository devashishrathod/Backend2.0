const Subscribed = require("../../models/Subscribed");
const {
  SUBSCRIBED_STATUS,
  SUBSCRIPTION_HISTORY_ACTION,
  HISTORY_PERFORMED_BY,
} = require("../../constants/subscription");
const { getSubscriptionConfig } = require("../../helpers/settings");
const Subscription = require("../../models/Subscription");
const {
  syncBrandSubscriptionState,
  recordSubscribedHistory,
} = require("../../helpers/subscribeds");
const {
  notifySubscriptionExpired,
} = require("../../helpers/notifications");

/**
 * Retire every subscription whose end date has passed.
 *
 * This is the piece that was missing entirely: `jobs/index.js` was empty and
 * nothing ever set a subscription back to expired, so `brand.isSubscribed`
 * stayed true forever once a vendor had paid a single time.
 *
 * Two-step on purpose. The bulk update retires the documents in one write, then
 * each affected brand is resynced individually — `syncBrandSubscriptionState`
 * has to re-derive limits from whatever plan (if any) is still live, which a
 * bulk update cannot do. Brands with another live plan correctly keep theirs.
 *
 * `getActiveSubscription` self-heals the same condition on read, so a skipped
 * run delays cleanup rather than breaking correctness.
 */
exports.expireSubscriptions = async () => {
  const config = await getSubscriptionConfig();
  const now = new Date();

  // A grace period lets a plan stay usable for N days past its end date.
  const cutoff = config.gracePeriodDays
    ? new Date(now.getTime() - config.gracePeriodDays * 24 * 60 * 60 * 1000)
    : now;

  const due = await Subscribed.find({
    status: SUBSCRIBED_STATUS.ACTIVE,
    endDate: { $lte: cutoff },
    isDeleted: false,
  })
    .select("_id brandId subscriptionId transactionId startDate endDate price")
    .lean();

  if (!due.length) {
    return { matched: 0, expired: 0, brandsUpdated: 0, stillSubscribed: 0 };
  }

  const result = await Subscribed.updateMany(
    { _id: { $in: due.map((doc) => doc._id) } },
    {
      $set: {
        status: SUBSCRIBED_STATUS.EXPIRED,
        isActive: false,
        isExpired: true,
        expiredAt: now,
      },
    },
  );

  const brandIds = [...new Set(due.map((doc) => String(doc.brandId)))];
  let stillSubscribed = 0;

  for (const brandId of brandIds) {
    try {
      const sync = await syncBrandSubscriptionState(brandId);
      if (sync.isSubscribed) stillSubscribed += 1;
    } catch (error) {
      // One bad brand must not abort the sweep for the rest.
      console.error(
        `[expireSubscriptions] failed to resync brand ${brandId}:`,
        error?.message,
      );
    }
  }

  // Tell each vendor their plan lapsed. Deduped per plan, so a re-run is safe.
  for (const doc of due) {
    try {
      const subscription = await Subscription.findById(doc.subscriptionId)
        .select("name")
        .lean();
      await notifySubscriptionExpired({ subscribed: doc, subscription });
    } catch (error) {
      console.error(
        `[expireSubscriptions] notify failed for ${doc._id}:`,
        error?.message,
      );
    }
  }

  await Promise.all(
    due.map((doc) =>
      recordSubscribedHistory({
        brandId: doc.brandId,
        subscribedId: doc._id,
        transactionId: doc.transactionId,
        action: SUBSCRIPTION_HISTORY_ACTION.EXPIRED,
        performedByRole: HISTORY_PERFORMED_BY.SYSTEM,
        fromSubscriptionId: doc.subscriptionId,
        startDate: doc.startDate,
        endDate: doc.endDate,
        reason: "Subscription period ended",
        snapshot: { gracePeriodDays: config.gracePeriodDays },
      }),
    ),
  );

  return {
    matched: result.matchedCount || due.length,
    expired: result.modifiedCount || 0,
    brandsUpdated: brandIds.length,
    // Brands that had a second live plan and stay subscribed.
    stillSubscribed,
  };
};

// Kept for symmetry with the job registry, which reports counts.
exports.countExpiringSoon = async (days = 7) => {
  const now = new Date();
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return Subscribed.countDocuments({
    status: SUBSCRIBED_STATUS.ACTIVE,
    endDate: { $gt: now, $lte: until },
    isDeleted: false,
  });
};
