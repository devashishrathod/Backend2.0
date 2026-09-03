const Subscribed = require("../../models/Subscribed");
const { SUBSCRIBED_STATUS } = require("../../constants/subscription");
const { syncBrandSubscriptionState } = require("./syncBrandSubscriptionState");

/**
 * The brand's live subscription, or null.
 *
 * State-independent by design: it trusts `status === ACTIVE` **and**
 * `endDate > now` together, never a standalone boolean flag. That is what makes
 * it correct regardless of whether the expiry job has run.
 *
 * Self-healing: if a document still claims ACTIVE but its endDate has passed,
 * this expires it on the spot and resyncs the brand before answering. So a
 * missed cron run degrades into a slightly later write, not a vendor keeping
 * paid features for free.
 *
 * @param {string|object} brandId
 * @param {object}  [options]
 * @param {boolean} [options.heal=true]  set false for read-only callers (admin
 *                                       listings) that must not write.
 * @returns {Promise<object|null>} the live Subscribed doc (lean) or null
 */
exports.getActiveSubscription = async (brandId, { heal = true } = {}) => {
  const now = new Date();

  const live = await Subscribed.findOne({
    brandId,
    status: SUBSCRIBED_STATUS.ACTIVE,
    endDate: { $gt: now },
    isDeleted: false,
  })
    .sort({ endDate: -1 })
    .lean();

  if (live) return live;

  if (!heal) return null;

  // Nothing live. Is anything stuck in ACTIVE with a date in the past?
  const stale = await Subscribed.find({
    brandId,
    status: SUBSCRIBED_STATUS.ACTIVE,
    endDate: { $lte: now },
    isDeleted: false,
  })
    .select("_id")
    .lean();

  if (!stale.length) return null;

  await Subscribed.updateMany(
    { _id: { $in: stale.map((doc) => doc._id) } },
    {
      $set: {
        status: SUBSCRIBED_STATUS.EXPIRED,
        isActive: false,
        isExpired: true,
        expiredAt: now,
      },
    },
  );
  console.warn(
    `[getActiveSubscription] self-healed ${stale.length} stale ACTIVE subscription(s) for brand ${brandId}`,
  );

  await syncBrandSubscriptionState(brandId);
  return null;
};
