const mongoose = require("mongoose");
const { transactionField, brandField } = require("./validObjectId");
const { WEBHOOK_PROVIDERS, WEBHOOK_STATUS } = require("../constants/webhook");
const {
  RAZORPAY_ACCOUNTS,
  TRANSACTION_PURPOSE,
} = require("../constants/transaction");

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
    /**
     * The dedupe key.
     *
     * For a **verified** delivery this is the `x-razorpay-event-id` header —
     * stable across Razorpay's retries of the same logical event — falling back
     * to a composite when the header is absent.
     *
     * For a **rejected** one it is `REJECTED:<account>:<sha256(rawBody)>`
     * instead. It must never be the raw header there: on an unverified request
     * that header is attacker-controlled, and a rejected row occupying a real
     * event id would make the genuine, correctly-signed retry of that event
     * collide, be reported DUPLICATE, and be answered 200 — so it would never
     * be processed and the payment behind it would never settle.
     */
    eventId: { type: String, required: true, unique: true },
    // The header exactly as received, kept for forensics. NOT unique and never
    // used for dedupe, because on a rejected delivery it is untrusted input.
    claimedEventId: { type: String },
    event: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: Object.values(WEBHOOK_STATUS),
      default: WEBHOOK_STATUS.RECEIVED,
      required: true,
    },

    // Which Razorpay account this delivery belongs to. Taken from the ROUTE it
    // arrived on, not from whichever secret happened to verify it.
    account: {
      type: String,
      enum: Object.values(RAZORPAY_ACCOUNTS),
      index: true,
    },
    // False when the delivery verified against the *other* account's secret —
    // i.e. the dashboard is pointed at the wrong URL. Still processed, but the
    // receiver raises a warning so it gets fixed rather than silently working.
    matchedExpectedAccount: { type: Boolean },
    // Resolved once the transaction is found; lets the admin worklist separate
    // subscription deliveries from voucher ones.
    purpose: {
      type: String,
      enum: Object.values(TRANSACTION_PURPOSE),
      index: true,
    },

    // What the event pointed at, once resolved.
    razorpayOrderId: { type: String, index: true },
    razorpayPaymentId: { type: String, index: true },
    transactionId: transactionField,
    brandId: brandField,

    // Exactly what the gateway sent — but ONLY on a verified delivery. A
    // rejected payload is unverified, attacker-controlled input; there is no
    // forensic case for storing it whole, so those rows carry the three fields
    // below instead.
    payload: { type: mongoose.Schema.Types.Mixed },
    payloadSha256: { type: String },
    payloadBytes: { type: Number },
    payloadPreview: { type: String },
    sourceIp: { type: String },
    // What we did about it, in plain words — useful when reading the log later.
    outcome: { type: String, trim: true },
    error: { type: String, trim: true },
    processedAt: { type: Date },
    attempts: { type: Number, default: 1 },
    // When this row may be swept. Set once the delivery reaches a terminal
    // status; a row with no `expiresAt` is never expired.
    expiresAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

webhookEventSchema.index({ status: 1, createdAt: -1 });
webhookEventSchema.index({ event: 1, createdAt: -1 });
webhookEventSchema.index({ account: 1, status: 1, createdAt: -1 });
webhookEventSchema.index({ purpose: 1, status: 1, createdAt: -1 });

/**
 * Retention.
 *
 * `expireAfterSeconds: 0` means "expire at the instant `expiresAt` says", which
 * puts the decision on the row rather than the index — a document that never
 * gets an `expiresAt` is simply never swept. That matters here because rejected
 * deliveries and verified ones are kept for different reasons and different
 * lengths, and an investigation may need to pin one indefinitely.
 *
 * Without this the collection only grows: a verified Razorpay payload is a few
 * kilobytes, and at voucher-claim volume that is the largest thing in the
 * database inside a couple of months.
 */
webhookEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("WebhookEvent", webhookEventSchema);
