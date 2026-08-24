/**
 * Webhook enums.
 *
 * Payment verification used to be client-driven only: if the vendor closed the
 * tab between paying and the browser calling back, the money was captured and no
 * plan was ever activated. The webhook closes that hole.
 */

const WEBHOOK_PROVIDERS = Object.freeze({
  RAZORPAY: "RAZORPAY",
});

// Only the events we act on. Anything else is stored and acknowledged so
// Razorpay stops retrying, but changes no state.
const RAZORPAY_WEBHOOK_EVENTS = Object.freeze({
  PAYMENT_CAPTURED: "payment.captured",
  PAYMENT_AUTHORIZED: "payment.authorized",
  PAYMENT_FAILED: "payment.failed",
  ORDER_PAID: "order.paid",
  REFUND_CREATED: "refund.created",
  REFUND_PROCESSED: "refund.processed",
  REFUND_FAILED: "refund.failed",
  // A chargeback. There is a response deadline (`respond_by` on the entity),
  // and missing it forfeits the dispute automatically — so these must surface
  // somewhere a human will see them, not just be logged.
  DISPUTE_CREATED: "payment.dispute.created",
  DISPUTE_UNDER_REVIEW: "payment.dispute.under_review",
  DISPUTE_ACTION_REQUIRED: "payment.dispute.action_required",
  DISPUTE_WON: "payment.dispute.won",
  DISPUTE_LOST: "payment.dispute.lost",
  DISPUTE_CLOSED: "payment.dispute.closed",
});

// Razorpay's dispute lifecycle, mirrored onto the transaction.
const DISPUTE_STATUS = Object.freeze({
  OPEN: "OPEN",
  UNDER_REVIEW: "UNDER_REVIEW",
  ACTION_REQUIRED: "ACTION_REQUIRED",
  WON: "WON",
  LOST: "LOST",
  CLOSED: "CLOSED",
});

// event -> the status it puts the transaction into.
const DISPUTE_EVENT_STATUS = Object.freeze({
  "payment.dispute.created": DISPUTE_STATUS.OPEN,
  "payment.dispute.under_review": DISPUTE_STATUS.UNDER_REVIEW,
  "payment.dispute.action_required": DISPUTE_STATUS.ACTION_REQUIRED,
  "payment.dispute.won": DISPUTE_STATUS.WON,
  "payment.dispute.lost": DISPUTE_STATUS.LOST,
  "payment.dispute.closed": DISPUTE_STATUS.CLOSED,
});

const WEBHOOK_HANDLED_EVENTS = Object.freeze([
  RAZORPAY_WEBHOOK_EVENTS.PAYMENT_CAPTURED,
  RAZORPAY_WEBHOOK_EVENTS.ORDER_PAID,
  RAZORPAY_WEBHOOK_EVENTS.PAYMENT_FAILED,
  RAZORPAY_WEBHOOK_EVENTS.REFUND_PROCESSED,
  RAZORPAY_WEBHOOK_EVENTS.DISPUTE_CREATED,
  RAZORPAY_WEBHOOK_EVENTS.DISPUTE_UNDER_REVIEW,
  RAZORPAY_WEBHOOK_EVENTS.DISPUTE_ACTION_REQUIRED,
  RAZORPAY_WEBHOOK_EVENTS.DISPUTE_WON,
  RAZORPAY_WEBHOOK_EVENTS.DISPUTE_LOST,
  RAZORPAY_WEBHOOK_EVENTS.DISPUTE_CLOSED,
]);

// Statuses a replay is allowed to act on. A PROCESSED event is already done and
// re-running it would be pointless; a DUPLICATE never had its own work to do.
const WEBHOOK_REPLAYABLE_STATUSES = Object.freeze(["FAILED", "IGNORED"]);

const WEBHOOK_STATUS = Object.freeze({
  RECEIVED: "RECEIVED",
  PROCESSED: "PROCESSED",
  // Signature verified and stored, but the event is not one we act on.
  IGNORED: "IGNORED",
  // Verified but processing threw. Kept for replay rather than lost.
  FAILED: "FAILED",
  // A repeat delivery of an event id we have already seen.
  DUPLICATE: "DUPLICATE",
});

const WEBHOOK_DEFAULTS = Object.freeze({
  // Razorpay signs the raw body; this is the header carrying that signature.
  signatureHeader: "x-razorpay-signature",
  // Stable per logical event across Razorpay's retries.
  eventIdHeader: "x-razorpay-event-id",
  maxPayloadBytes: 1024 * 512,
});

module.exports = {
  WEBHOOK_PROVIDERS,
  RAZORPAY_WEBHOOK_EVENTS,
  WEBHOOK_HANDLED_EVENTS,
  WEBHOOK_REPLAYABLE_STATUSES,
  WEBHOOK_STATUS,
  WEBHOOK_DEFAULTS,
  DISPUTE_STATUS,
  DISPUTE_EVENT_STATUS,
};
