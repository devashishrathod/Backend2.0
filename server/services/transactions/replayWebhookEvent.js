const WebhookEvent = require("../../models/WebhookEvent");
const {
  WEBHOOK_STATUS,
  WEBHOOK_REPLAYABLE_STATUSES,
  WEBHOOK_NEVER_REPLAYABLE_STATUSES,
} = require("../../constants/webhook");
const { throwError } = require("../../utils");
const {
  processWebhookEvent,
  extractWebhookIds,
} = require("./handleRazorpayWebhook");

/**
 * Re-run a stored webhook delivery.
 *
 * The situation this exists for: Razorpay sends `payment.captured`, the
 * processing throws (a DB blip, a timeout, a bug), and the endpoint answers 200
 * — because a non-2xx would have Razorpay retry that delivery forever. So the
 * money is captured, the plan is not live, and **Razorpay will never send it
 * again**. Before this, the only ways out were asking the vendor to reload the
 * checkout page or granting the plan by hand.
 *
 * Authenticity is not re-checked, and does not need to be: the HMAC was verified
 * when the delivery was first stored, the payload has been immutable since, and
 * the caller here is an authenticated admin.
 *
 * Safe to run twice. The settlement underneath claims the transaction with a
 * conditional update on `verified: false`, so a replay of an event that has
 * since been settled reports that instead of activating a second subscription.
 */
exports.replayWebhookEvent = async (actor, payload) => {
  const { eventId, force } = payload;

  // Accepts either the gateway's event id or our own document id, since an admin
  // reading the listing has the latter to hand.
  const record = await WebhookEvent.findOne({
    $or: [
      { eventId },
      ...(/^[0-9a-fA-F]{24}$/.test(String(eventId)) ? [{ _id: eventId }] : []),
    ],
  });
  if (!record) throwError(404, "Webhook event not found.");

  // ---------------------------------------------------------------------------
  // Checked BEFORE the `force` escape hatch, deliberately.
  //
  // Replay skips signature verification — correctly, because the payload was
  // proven authentic when it was first stored. A REJECTED row is the one case
  // where that premise is false: its signature never verified, so its body is
  // unverified, attacker-controlled input. Force-replaying one would feed that
  // straight into the settlement path, turning `force: true` into a
  // free-subscription button for anyone who can reach the public webhook URL.
  //
  // There is no legitimate use for it either: a genuinely rejected delivery is
  // fixed by correcting the secret and letting Razorpay retry, or by
  // reconciling against Razorpay directly.
  // ---------------------------------------------------------------------------
  if (WEBHOOK_NEVER_REPLAYABLE_STATUSES.includes(record.status)) {
    throwError(
      422,
      `This delivery is ${record.status} — its signature never verified, so its payload is untrusted and can never be replayed. Fix the webhook secret and let Razorpay retry, or reconcile the payment directly.`,
    );
  }

  if (!record.payload) {
    throwError(
      422,
      "This event has no stored payload, so it cannot be replayed.",
    );
  }

  // A PROCESSED event is already done; re-running it is almost always a mistake,
  // so it takes an explicit `force`.
  if (
    !WEBHOOK_REPLAYABLE_STATUSES.includes(record.status) &&
    !force
  ) {
    throwError(
      422,
      `This event is ${record.status}, not FAILED or IGNORED. Pass force: true if you are certain you want to re-run it.`,
    );
  }

  const before = {
    status: record.status,
    outcome: record.outcome || null,
    error: record.error || null,
    attempts: record.attempts,
  };

  await WebhookEvent.updateOne(
    { _id: record._id },
    { $inc: { attempts: 1 }, $set: { status: WEBHOOK_STATUS.RECEIVED } },
  );

  const ids = extractWebhookIds(record.payload);

  let result;
  try {
    result = await processWebhookEvent({
      record,
      event: record.event,
      ids,
      isReplay: true,
    });
  } catch (error) {
    // A replay is an explicit admin action, so unlike the receiving endpoint it
    // reports the failure rather than swallowing it — the admin is standing
    // right there and needs to know it did not work.
    await WebhookEvent.updateOne(
      { _id: record._id },
      {
        $set: {
          status: WEBHOOK_STATUS.FAILED,
          error: error?.message,
          processedAt: new Date(),
        },
      },
    );
    throwError(
      error?.statusCode && error.statusCode < 500 ? error.statusCode : 422,
      `Replay failed: ${error?.message}`,
    );
  }

  const after = await WebhookEvent.findById(record._id).lean();

  return {
    eventId: record.eventId,
    event: record.event,
    replayedBy: actor.userId,
    before,
    after: {
      status: after.status,
      outcome: after.outcome,
      error: after.error || null,
      attempts: after.attempts,
    },
    // True when the replay actually changed the outcome, which is what the admin
    // wants to know at a glance.
    recovered:
      before.status === WEBHOOK_STATUS.FAILED &&
      after.status === WEBHOOK_STATUS.PROCESSED,
    result,
  };
};
