const Subscribed = require("../../models/Subscribed");
const {
  SUBSCRIPTION_HISTORY_ACTION,
} = require("../../constants/subscription");
const { throwError } = require("../../utils");
const { recordSubscribedHistory } = require("../../helpers/subscribeds");

/**
 * Mark a forfeited term as settled.
 *
 * Records that a vendor who lost paid-for days on an upgrade has been made whole
 * — whether that was a credit, a free extension, or a decision that none was
 * owed. Purely a bookkeeping stamp: it moves no money and changes no plan, so
 * whatever compensation was actually given is described in `note` and, if it was
 * an extension, granted through the normal admin grant flow.
 *
 * Keeps `GET /subscribeds/admin/forfeited` an actionable worklist instead of a
 * list that only ever grows.
 */
exports.markForfeitCompensated = async (actor, payload) => {
  const { subscribedId, note } = payload;

  const subscribed = await Subscribed.findById(subscribedId);
  if (!subscribed || subscribed.isDeleted) {
    throwError(404, "Subscription record not found!");
  }
  if (!subscribed.forfeitedDays) {
    throwError(422, "This subscription did not forfeit any days.");
  }
  if (subscribed.forfeitCompensatedAt) {
    throwError(
      422,
      "This forfeit has already been marked as compensated.",
    );
  }

  const now = new Date();
  subscribed.forfeitCompensatedAt = now;
  subscribed.forfeitCompensationNote = note;
  await subscribed.save();

  await recordSubscribedHistory({
    brandId: subscribed.brandId,
    subscribedId: subscribed._id,
    action: SUBSCRIPTION_HISTORY_ACTION.DOWNGRADED,
    performedBy: actor.userId,
    role: actor.role,
    fromSubscriptionId: subscribed.subscriptionId,
    reason: note,
    snapshot: {
      forfeitCompensated: true,
      forfeitedDays: subscribed.forfeitedDays,
      forfeitedValue: subscribed.forfeitedValue,
      compensatedAt: now,
    },
  });

  return {
    subscribedId: subscribed._id,
    brandId: subscribed.brandId,
    forfeitedDays: subscribed.forfeitedDays,
    forfeitedValue: subscribed.forfeitedValue,
    forfeitCompensatedAt: now,
    forfeitCompensationNote: note,
  };
};
