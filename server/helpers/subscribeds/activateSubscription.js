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

/** Did this insert lose the race for `uniq_subscribed_transactionId`? */
const isDuplicateTransaction = (error) =>
  error?.code === 11000 &&
  Object.prototype.hasOwnProperty.call(error?.keyPattern || {}, "transactionId");

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
 * ### ⚠️ Activating twice for one transaction is the thing to prevent
 *
 * Until `resumeIncompleteSettlements` learned about subscriptions this could not
 * happen: `settleSubscriptionPayment` claims the transaction with a conditional
 * update on `verified: false`, and a replay never got as far as calling this.
 * A **resume deliberately skips that claim** — that is what resuming is — so the
 * guard has to live here instead.
 *
 * Without it a resume would create a second ACTIVE document, then hand it to the
 * supersede block as the plan to retire. The vendor's just-purchased plan would
 * be marked UPGRADED with its end date moved to now, and `measureForfeit` would
 * bill the whole unused term as forfeited — a fabricated debt that lands in the
 * goodwill-credit worklist behind `GET /subscribeds/admin/forfeited`.
 *
 * So a transaction that already has a subscription returns that one, untouched:
 * no create, no supersede, no forfeit, no second audit row. Only the entitlement
 * sync runs again, because it is idempotent and may well be the step that failed.
 *
 * @returns {{ subscribed, previous, sync, forfeit, notice, resumed }}
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

  /**
   * What to hand back when the plan is already live for this transaction.
   *
   * `previous` and `forfeit` are read off what the first run recorded rather
   * than recomputed — recomputing `forfeit` against a plan already retired would
   * measure zero remaining days and quietly overwrite a real number with 0.
   */
  const alreadyActive = async (existing) => {
    const previousRow = existing.previousSubscribedId
      ? await Subscribed.findById(existing.previousSubscribedId).lean()
      : null;

    return {
      subscribed: existing,
      previous: previousRow,
      // Idempotent, and the likeliest step to have been interrupted: it is what
      // flips Brand.isSubscribed and re-applies the plan's limits.
      sync: await syncBrandSubscriptionState(brand._id),
      forfeit: {
        forfeitedDays: previousRow?.forfeitedDays || 0,
        forfeitedValue: previousRow?.forfeitedValue || 0,
      },
      notice: {
        brand,
        subscription,
        subscribed: existing,
        action,
        isAdminGrant: source === SUBSCRIPTION_SOURCE.ADMIN_MANUAL,
        forfeitedDays: previousRow?.forfeitedDays || 0,
      },
      // The caller's signal that nothing new was created, so it can skip the
      // writes that are only correct the first time.
      resumed: true,
    };
  };

  if (transaction?._id) {
    const existing = await Subscribed.findOne({
      transactionId: transaction._id,
      isDeleted: false,
    });
    if (existing) return alreadyActive(existing);
  }

  const previous = await getActiveSubscription(brand._id);

  let subscribed;
  try {
    subscribed = await Subscribed.create({
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
  } catch (error) {
    /**
     * Lost the race, not a failure.
     *
     * The read above and this insert are two operations, so two settlement
     * attempts can both find nothing and both try to create. The unique partial
     * index picks a winner; the loser lands here and adopts what the winner
     * made, which is exactly what the guard above would have returned had it run
     * a moment later.
     */
    if (!isDuplicateTransaction(error) || !transaction?._id) throw error;

    const winner = await Subscribed.findOne({
      transactionId: transaction._id,
      isDeleted: false,
    });
    // A duplicate key with nothing behind it would mean the winning row is
    // soft-deleted. Nothing sensible to adopt, so let the error stand.
    if (!winner) throw error;
    return alreadyActive(winner);
  }

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
    // Symmetrical with the replay path above, so a caller can branch on it
    // without having to test for `undefined`.
    resumed: false,
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
