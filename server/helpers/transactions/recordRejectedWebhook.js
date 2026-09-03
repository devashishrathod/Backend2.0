const crypto = require("crypto");
const WebhookEvent = require("../../models/WebhookEvent");
const {
  WEBHOOK_PROVIDERS,
  WEBHOOK_STATUS,
  WEBHOOK_DEFAULTS,
  WEBHOOK_RETENTION,
} = require("../../constants/webhook");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Record a delivery whose signature did not verify.
 *
 * **Why this exists.** Until now the receiver threw before writing anything, so
 * a rejected delivery left no trace at all. That is fine while there is one
 * webhook secret and it is correct. It stops being fine the moment there are
 * two accounts: if the CUSTOMER secret is wrong or has not been deployed yet,
 * every delivery is rejected, Razorpay retries a few times and gives up, and the
 * result is money captured with no claim, no invoice, no notification, and
 * nothing in the database to find it by. Silent, and permanent.
 *
 * **Why the key is namespaced.** The only identifier available on an unverified
 * request is the `x-razorpay-event-id` header — which is attacker-controlled at
 * that point. Writing the row under it would let a rejected row occupy a real
 * event id; the genuine, correctly-signed retry of that same event would then
 * collide on the unique index, be reported as a DUPLICATE, answered 200, and
 * never processed. The rejected write would *cause* the failure it exists to
 * make visible.
 *
 * So the key is derived from the body instead:
 *
 *     REJECTED:<account>:<sha256(rawBody)>
 *
 * **Why it is deterministic.** A timestamp in the key would make every rejected
 * delivery a new document, and this endpoint is public — anyone who knows the
 * URL could fill the collection. Deterministic means repeated rejections of the
 * same body collapse into one row with a rising `attempts`, which is also the
 * number worth alerting on.
 *
 * **Why the payload is not stored.** It is unverified, attacker-controlled
 * input. A hash, a length and a short preview identify it well enough to
 * recognise a genuine Razorpay body; keeping the whole thing buys nothing and
 * costs storage an outsider controls.
 *
 * Never throws — the caller still has to return 400, and losing the audit row
 * must not turn that into a 500.
 *
 * @returns {Promise<{ recorded: boolean, eventId?: string, attempts?: number }>}
 */
exports.recordRejectedWebhook = async ({
  rawBody,
  account,
  event,
  claimedEventId,
  sourceIp,
  reason,
}) => {
  try {
    if (!rawBody?.length) return { recorded: false };

    const payloadSha256 = crypto
      .createHash("sha256")
      .update(rawBody)
      .digest("hex");

    const eventId = `${WEBHOOK_DEFAULTS.rejectedEventIdPrefix}:${
      account || "UNKNOWN"
    }:${payloadSha256}`;

    // Upsert rather than create-then-catch: the whole point of the deterministic
    // key is that a repeat is an increment, not a new row.
    const record = await WebhookEvent.findOneAndUpdate(
      { eventId },
      {
        $inc: { attempts: 1 },
        $set: {
          status: WEBHOOK_STATUS.REJECTED,
          error: reason,
          processedAt: new Date(),
          expiresAt: new Date(
            Date.now() + WEBHOOK_RETENTION.REJECTED_DAYS * DAY_MS,
          ),
          sourceIp,
          claimedEventId,
        },
        $setOnInsert: {
          provider: WEBHOOK_PROVIDERS.RAZORPAY,
          event: event || "unknown",
          account,
          payloadSha256,
          payloadBytes: rawBody.length,
          payloadPreview: rawBody
            .subarray(0, WEBHOOK_DEFAULTS.rejectedPayloadPreviewBytes)
            .toString("utf8"),
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: false },
    );

    return { recorded: true, eventId, attempts: record?.attempts ?? 1 };
  } catch (error) {
    console.error(
      "[recordRejectedWebhook] could not record a rejected delivery:",
      error?.message,
    );
    return { recorded: false };
  }
};
