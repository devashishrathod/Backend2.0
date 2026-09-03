const Brand = require("../../models/Brand");
const Subscribed = require("../../models/Subscribed");
const Subscription = require("../../models/Subscription");
const { SUBSCRIBED_STATUS } = require("../../constants/subscription");
const { getSubscriptionConfig } = require("../../helpers/settings");
const {
  notifySubscriptionExpiring,
} = require("../../helpers/notifications");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Warn vendors whose plan is about to lapse.
 *
 * Offsets come from `Setting.vendor.subscription.expiryReminderDays` (default
 * [7, 3, 1]) so they can be changed without a deploy.
 *
 * Idempotent in two independent ways, because this runs every few hours:
 *  - `Subscribed.remindersSent` records which offsets have already fired and is
 *    updated with `$addToSet`, so a restart mid-run cannot double-send.
 *  - the notification itself carries a unique `dedupeKey` per (plan, offset),
 *    so even a lost `remindersSent` write cannot produce a second message.
 *
 * A brand is matched to the **smallest** offset it has crossed, so a plan
 * expiring in 2 days fires the "3 day" reminder once rather than nothing.
 */
exports.sendExpiryReminders = async () => {
  const config = await getSubscriptionConfig();
  const offsets = [...(config.expiryReminderDays || [])]
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  if (!offsets.length) return { checked: 0, sent: 0, skipped: 0 };

  const now = new Date();
  const widest = offsets[offsets.length - 1];

  const due = await Subscribed.find({
    status: SUBSCRIBED_STATUS.ACTIVE,
    endDate: { $gt: now, $lte: new Date(now.getTime() + widest * DAY_MS) },
    isDeleted: false,
  })
    .select("_id brandId subscriptionId endDate remindersSent")
    .lean();

  let sent = 0;
  let skipped = 0;

  for (const subscribed of due) {
    try {
      const daysRemaining = Math.ceil(
        (new Date(subscribed.endDate).getTime() - now.getTime()) / DAY_MS,
      );

      // The tightest offset this plan has already crossed.
      const offset = offsets.find((value) => daysRemaining <= value);
      if (!offset) {
        skipped += 1;
        continue;
      }
      if ((subscribed.remindersSent || []).includes(offset)) {
        skipped += 1;
        continue;
      }

      const [brand, subscription] = await Promise.all([
        Brand.findById(subscribed.brandId)
          .select("_id brandName email userId isDeleted")
          .lean(),
        Subscription.findById(subscribed.subscriptionId).select("name").lean(),
      ]);

      // Orphaned or deleted brands have nobody to notify.
      if (!brand || brand.isDeleted) {
        skipped += 1;
        continue;
      }

      const result = await notifySubscriptionExpiring({
        brand,
        subscription,
        subscribed,
        daysRemaining,
        offset,
      });

      // Recorded even when the notification was a duplicate, so the offset is
      // not retried on every tick.
      await Subscribed.updateOne(
        { _id: subscribed._id },
        { $addToSet: { remindersSent: offset } },
      );

      if (result.created) sent += 1;
      else skipped += 1;
    } catch (error) {
      // One bad row must not abort the sweep.
      console.error(
        `[sendExpiryReminders] failed for subscription ${subscribed._id}:`,
        error?.message,
      );
      skipped += 1;
    }
  }

  return { checked: due.length, sent, skipped, offsets };
};
