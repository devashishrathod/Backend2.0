const mongoose = require("mongoose");
const { transactionField, brandField } = require("./validObjectId");
const { WEBHOOK_PROVIDERS, WEBHOOK_STATUS } = require("../constants/webhook");

/**
 * Every webhook delivery, stored before it is acted on.
 *
 * Two jobs:
 *
 *  1. **Idempotency.** Razorpay retries a delivery until it gets a 2xx, and can
 *     send the same event more than once regardless. `eventId` is unique, so a
 *     repeat delivery is recognised and becomes a no-op instead of activating a
 *     plan twice.
 *  2. **Replay and forensics.** The raw payload is kept, so an event that failed
 *     processing can be re-run and a disputed payment can be reconstructed from
 *     what the gateway actually sent.
 */
const webhookEventSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: Object.values(WEBHOOK_PROVIDERS),
      default: WEBHOOK_PROVIDERS.RAZORPAY,
      required: true,
    },
    // From the x-razorpay-event-id header — stable across retries of the same
    // logical event. Falls back to a composite when the header is absent.
    eventId: { type: String, required: true, unique: true },
    event: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: Object.values(WEBHOOK_STATUS),
      default: WEBHOOK_STATUS.RECEIVED,
      required: true,
    },
    // What the event pointed at, once resolved.
    razorpayOrderId: { type: String, index: true },
    razorpayPaymentId: { type: String, index: true },
    transactionId: transactionField,
    brandId: brandField,
    // Exactly what the gateway sent.
    payload: { type: mongoose.Schema.Types.Mixed },
    // What we did about it, in plain words — useful when reading the log later.
    outcome: { type: String, trim: true },
    error: { type: String, trim: true },
    processedAt: { type: Date },
    attempts: { type: Number, default: 1 },
  },
  { timestamps: true, versionKey: false },
);

webhookEventSchema.index({ status: 1, createdAt: -1 });
webhookEventSchema.index({ event: 1, createdAt: -1 });

module.exports = mongoose.model("WebhookEvent", webhookEventSchema);
