const Subscribed = require("../../models/Subscribed");
const Transaction = require("../../models/Transaction");
const {
  SUBSCRIBED_STATUS,
  SUBSCRIPTION_ACTION,
  SUBSCRIPTION_SOURCE,
  SUBSCRIPTION_HISTORY_ACTION,
} = require("../../constants/subscription");
const { getActiveSubscription } = require("./getActiveSubscription");
const { syncBrandSubscriptionState } = require("./syncBrandSubscriptionState");
const { recordSubscribedHistory } = require("./recordSubscribedHistory");
const { round2 } = require("./calculatePricing");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the vendor gives up by replacing a plan mid-term.
 *
 * No proration is applied — the policy states upfront that the current plan ends
 * when the new one starts. But the loss is measured and recorded so those
 * vendors can be found later and compensated with credit or a goodwill
 * extension. See `GET /subscribeds/admin/forfeited`.
 */
const measureForfeit = (previous, now) => {
  if (!previous?.endDate) return { forfeitedDays: 0, forfeitedValue: 0 };

  const remainingMs = new Date(previous.endDate).getTime() - now.getTime();
  if (remainingMs <= 0) return { forfeitedDays: 0, forfeitedValue: 0 };

  const forfeitedDays = Math.ceil(remainingMs / DAY_MS);

  // Value the lost days against what was actually paid for the term, taking the
  // taxable value so a refund decision is not tangled up with GST.
  const totalDays =
    previous.durationInDays ||
    (previous.startDate
      ? Math.max(
          1,
          Math.ceil(
            (new Date(previous.endDate).getTime() -
              new Date(previous.startDate).getTime()) /
              DAY_MS,
          ),
        )
      : 0);

  const basis = previous.pricing?.taxableValue ?? previous.price ?? 0;
  const forfeitedValue =
    totalDays > 0 ? round2((basis * forfeitedDays) / totalDays) : 0;

  return { forfeitedDays, forfeitedValue };
};

// What the plan being replaced becomes, and which pointer field links it
// forward to its successor so the chain stays walkable in both directions.
const SUPERSEDE = Object.freeze({
  [SUBSCRIPTION_ACTION.UPGRADE]: {
    status: SUBSCRIBED_STATUS.UPGRADED,
    pointer: "upgradedTo",
  },
  [SUBSCRIPTION_ACTION.DOWNGRADE]: {
    status: SUBSCRIBED_STATUS.DOWNGRADED,
    pointer: "downgradedTo",
  },
  [SUBSCRIPTION_ACTION.RENEW]: {
    status: SUBSCRIBED_STATUS.EXPIRED,
    pointer: "upgradedTo",
  },
});

const HISTORY_ACTION = Object.freeze({
  [SUBSCRIPTION_ACTION.NEW]: SUBSCRIPTION_HISTORY_ACTION.ACTIVATED,
  [SUBSCRIPTION_ACTION.RENEW]: SUBSCRIPTION_HISTORY_ACTION.RENEWED,
  [SUBSCRIPTION_ACTION.UPGRADE]: SUBSCRIPTION_HISTORY_ACTION.UPGRADED,
  [SUBSCRIPTION_ACTION.DOWNGRADE]: SUBSCRIPTION_HISTORY_ACTION.DOWNGRADED,
});

/**
 * Put a plan live on a brand.
 *
 * The one place a subscription is ever activated — reached from paid
 * verification, from an admin grant with no payment, and from an admin plan
 * change. Keeping it single means the state transitions, the entitlement sync
 * and the audit row can never be half-applied by one caller and not another.
 *
 * Ordering is deliberate: the new document is created and marked ACTIVE
 * *before* the old one is retired, so a crash in between leaves the brand with
 * a valid plan rather than none at all. `syncBrandSubscriptionState` then
 * reconciles the cache and re-applies limits, and is idempotent.
 *
 * @returns {{ subscribed, previous, sync }}
 */
exports.activateSubscription = async ({
  brand,
  subscription,
  actor = {},
  action,
  source = SUBSCRIPTION_SOURCE.PAYMENT,
  pricing,
  validity,
  transaction = null,
  paymentMode,
  referenceNumber,
  adminNote,
  paidAmount = 0,
  dueAmount = 0,
  isFreeGrant = false,
}) => {
  const now = new Date();
  const previous = await getActiveSubscription(brand._id);

  const subscribed = await Subscribed.create({
    userId: brand.userId,
    brandId: brand._id,
    subscribedBy: actor.userId,
    grantedByAdminId:
      source === SUBSCRIPTION_SOURCE.ADMIN_MANUAL ? actor.userId : undefined,
    upgradedBy:
      action === SUBSCRIPTION_ACTION.UPGRADE ||
      action === SUBSCRIPTION_ACTION.DOWNGRADE
        ? actor.userId
        : undefined,
    transactionId: transaction?._id,
    subscriptionId: subscription._id,
    previousSubscribedId: previous?._id,
    durationInDays: subscription.durationInDays,
    durationInYears: subscription.durationInYears,
    startDate: validity.startDate,
    endDate: validity.endDate,
    price: subscription.price,
    discount: pricing.discountAmount,
    paidAmount,
    dueAmount,
    pricing,
    status: SUBSCRIBED_STATUS.ACTIVE,
    source,
    paymentMode,
    referenceNumber,
    adminNote,
    isFreeGrant,
    activatedAt: now,
    // Legacy mirrors of `status` — kept in step for older readers.
    isActive: true,
    isExpired: false,
  });

  let forfeit = { forfeitedDays: 0, forfeitedValue: 0 };

  if (previous) {
    const supersede = SUPERSEDE[action] || {
      status: SUBSCRIBED_STATUS.EXPIRED,
      pointer: "upgradedTo",
    };
    // Measure before the end date is moved to now.
    forfeit = measureForfeit(previous, now);

    await Subscribed.updateOne(
      { _id: previous._id },
      {
        $set: {
          status: supersede.status,
          [supersede.pointer]: subscribed._id,
          isUpgraded: supersede.status === SUBSCRIBED_STATUS.UPGRADED,
          isActive: false,
          isExpired: true,
          endDate: now,
          expiredAt: now,
          upgradeDate: now,
          upgradedBy: actor.userId,
          forfeitedDays: forfeit.forfeitedDays,
          forfeitedValue: forfeit.forfeitedValue,
        },
        $inc: { numberOfUpgrade: 1 },
      },
    );
  }

  if (transaction?._id) {
    await Transaction.updateOne(
      { _id: transaction._id },
      { $set: { subscribedId: subscribed._id } },
    );
  }

  // Flips Brand.isSubscribed / subscribedId and re-applies the plan's limits.
  const sync = await syncBrandSubscriptionState(brand._id);

  await recordSubscribedHistory({
    brandId: brand._id,
    subscribedId: subscribed._id,
    transactionId: transaction?._id,
    action: HISTORY_ACTION[action] || SUBSCRIPTION_HISTORY_ACTION.ACTIVATED,
    performedBy: actor.userId,
    role: actor.role,
    fromSubscriptionId: previous?.subscriptionId,
    toSubscriptionId: subscription._id,
    source,
    paymentMode,
    amount: pricing.totalPayable,
    startDate: validity.startDate,
    endDate: validity.endDate,
    reason: adminNote,
    snapshot: {
      pricing,
      entitlements: sync.entitlements,
      entitlementsSource: sync.source,
      overflow: sync.overflow,
      previousSubscribedId: previous?._id,
      // Kept on the audit row too, so the goodwill-credit report can be built
      // from history alone.
      forfeitedDays: forfeit.forfeitedDays,
      forfeitedValue: forfeit.forfeitedValue,
    },
  });

  /**
   * ⚠️ The activation notice is **not** sent here any more.
   *
   * It carries the vendor's invoice number and their Download Invoice link, and
   * neither exists yet at this point in a paid settlement: the number is allotted
   * after activation, once the payment is known to be captured. Sent from here it
   * went out with a blank invoice number and no button — which is how vendors
   * ended up with no route to their own invoice at all.
   *
   * Both callers now send it after their document stage, which is also the order
   * the claim flow follows and for the same reason: notifications are the one
   * step whose failure costs nothing but a message, so they go last.
   */
  return {
    subscribed,
    previous,
    sync,
    forfeit,
    // What the caller needs to send that notice itself.
    notice: {
      brand,
      subscription,
      subscribed,
      action,
      isAdminGrant: source === SUBSCRIPTION_SOURCE.ADMIN_MANUAL,
      forfeitedDays: forfeit.forfeitedDays,
    },
  };
};
