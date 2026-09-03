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
  // Razorpay has released its own settlement INTO our bank. Only ever a
  // trigger: the payload carries the aggregate settlement entity (id, amount,
  // settled_at) and not the list of payments in it, so the payment-level
  // mapping still has to come from the recon API.
  SETTLEMENT_PROCESSED: "settlement.processed",
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

/**
 * Events this platform acts on. Anything else is stored and acknowledged so
 * Razorpay stops retrying, but changes no state.
 *
 * ⚠️ **An event joins this list in the same change as its handler, never before.**
 * `processWebhookEvent` falls through to the settlement router for anything
 * listed here, and the settler's first check is `payment.captured`. Listing
 * `payment.authorized` without giving it a branch of its own would therefore
 * fire the not-captured path on *every successful payment* — releasing the promo
 * hold and paging admins CRITICAL — milliseconds before the real capture arrives.
 *
 * Still to be added, each with its handler:
 *   refund.created/.failed -> S1  (refund pipeline)
 *   settlement.processed   -> S2  (fundsReceivedAt / reconcileSettlements)
 */
const WEBHOOK_HANDLED_EVENTS = Object.freeze([
  RAZORPAY_WEBHOOK_EVENTS.PAYMENT_CAPTURED,
  RAZORPAY_WEBHOOK_EVENTS.ORDER_PAID,
  // Records the authorization and stops there. It has its own branch above the
  // settlers precisely so it never reaches one — see handleRazorpayWebhook.
  RAZORPAY_WEBHOOK_EVENTS.PAYMENT_AUTHORIZED,
  RAZORPAY_WEBHOOK_EVENTS.PAYMENT_FAILED,
  RAZORPAY_WEBHOOK_EVENTS.REFUND_PROCESSED,
  /**
   * ⚠️ All three refund events, not just the happy one.
   *
   * `refund.created` and `refund.failed` had branches written for them and were
   * **not on this list** — so they never reached those branches at all. A failed
   * refund fell through as `IGNORED`: the customer's money never arrived, the
   * request still said `PROCESSING`, and nothing anywhere said otherwise.
   *
   * This list is the gate. A branch below it is unreachable code until the event
   * is named here, and nothing warns about the mismatch.
   */
  RAZORPAY_WEBHOOK_EVENTS.REFUND_CREATED,
  RAZORPAY_WEBHOOK_EVENTS.REFUND_FAILED,
  /**
   * Razorpay telling us a batch of payments has reached **our** bank. It is what
   * fills `fundsReceivedAt`, and vendor settlement eligibility keys on that
   * rather than on `verifiedAt` — paying a vendor from money the gateway has not
   * settled yet is how a platform funds its own float without deciding to.
   */
  RAZORPAY_WEBHOOK_EVENTS.SETTLEMENT_PROCESSED,
  RAZORPAY_WEBHOOK_EVENTS.DISPUTE_CREATED,
  RAZORPAY_WEBHOOK_EVENTS.DISPUTE_UNDER_REVIEW,
  RAZORPAY_WEBHOOK_EVENTS.DISPUTE_ACTION_REQUIRED,
  RAZORPAY_WEBHOOK_EVENTS.DISPUTE_WON,
  RAZORPAY_WEBHOOK_EVENTS.DISPUTE_LOST,
  RAZORPAY_WEBHOOK_EVENTS.DISPUTE_CLOSED,
]);

const WEBHOOK_STATUS = Object.freeze({
  RECEIVED: "RECEIVED",
  PROCESSED: "PROCESSED",
  // Signature verified and stored, but the event is not one we act on.
  IGNORED: "IGNORED",
  // Verified but processing threw. Kept for replay rather than lost.
  FAILED: "FAILED",
  // A repeat delivery of an event id we have already seen.
  DUPLICATE: "DUPLICATE",
  /**
   * Signature verification FAILED. The payload is unverified and
   * attacker-controllable, so it is recorded but never acted on.
   *
   * This status exists because the previous behaviour left no trace at all: the
   * endpoint threw before the row was written, so a webhook secret that was
   * wrong or not yet deployed produced captured payments with nothing anywhere
   * to show for them. A rejected delivery must be *visible*.
   */
  REJECTED: "REJECTED",
});

/**
 * Statuses a replay is allowed to act on.
 *
 * A PROCESSED event is already done and re-running it would be pointless; a
 * DUPLICATE never had its own work to do.
 *
 * REJECTED is deliberately absent, and unlike the others it cannot be overridden
 * with `force` either — replay skips signature verification by design, so
 * force-replaying an unverified payload would feed attacker-controlled JSON
 * straight into the settlement path. See services/transactions/replayWebhookEvent.js.
 *
 * Enum references rather than string literals: the two used to be able to drift.
 */
const WEBHOOK_REPLAYABLE_STATUSES = Object.freeze([
  WEBHOOK_STATUS.FAILED,
  WEBHOOK_STATUS.IGNORED,
]);

/** Never replayable, not even with `force`. */
const WEBHOOK_NEVER_REPLAYABLE_STATUSES = Object.freeze([
  WEBHOOK_STATUS.REJECTED,
]);

const WEBHOOK_DEFAULTS = Object.freeze({
  // Razorpay signs the raw body; this is the header carrying that signature.
  signatureHeader: "x-razorpay-signature",
  // Stable per logical event across Razorpay's retries.
  eventIdHeader: "x-razorpay-event-id",
  maxPayloadBytes: 1024 * 512,

  /**
   * Namespace for a rejected delivery's synthetic event id.
   *
   * A rejected delivery has no *trusted* identity — the only id available is the
   * `x-razorpay-event-id` header, which on an unverified request is
   * attacker-controlled. Writing the row under that header would let a rejected
   * row occupy a real event id, and then the genuine, correctly-signed retry of
   * that same event would hit the unique index, be reported as a DUPLICATE, and
   * be answered 200 — so it would never be processed and the payment would
   * never settle.
   *
   * The key is therefore namespaced and derived from the body itself:
   *
   *   REJECTED:<account>:<sha256(rawBody)>
   *
   * Deterministic on purpose. A timestamp would make every rejected delivery a
   * new row, so anyone who knows the URL could fill the collection. This way
   * repeated rejections of the same body collapse into one row with a rising
   * attempt count — which is also the signal worth alerting on.
   */
  rejectedEventIdPrefix: "REJECTED",
  // Enough of an unverified body to recognise it; never the whole thing.
  rejectedPayloadPreviewBytes: 512,
});

/**
 * How long a delivery is kept.
 *
 * Verified deliveries are the replay and forensics record, so they get the long
 * retention. Rejected ones decay in value fast — a rejected delivery nobody has
 * looked at in a month is not going to be investigated — and they are the only
 * rows an outsider can cause, so they get the short one.
 *
 * Applied through an explicit `expiresAt` date rather than a partial TTL index:
 * a document with no `expiresAt` is simply never expired, which makes "keep this
 * one" a property of the row instead of a property of the index.
 */
const WEBHOOK_RETENTION = Object.freeze({
  PROCESSED_DAYS: 90,
  REJECTED_DAYS: 30,
});

module.exports = {
  WEBHOOK_PROVIDERS,
  RAZORPAY_WEBHOOK_EVENTS,
  WEBHOOK_HANDLED_EVENTS,
  WEBHOOK_REPLAYABLE_STATUSES,
  WEBHOOK_NEVER_REPLAYABLE_STATUSES,
  WEBHOOK_STATUS,
  WEBHOOK_DEFAULTS,
  WEBHOOK_RETENTION,
  DISPUTE_STATUS,
  DISPUTE_EVENT_STATUS,
};
