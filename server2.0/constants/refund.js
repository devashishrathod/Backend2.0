/**
 * Refund vocabulary.
 *
 * Separate from `REFUND_STATUS` in `constants.js`, and the distinction is
 * load-bearing:
 *
 * | | What it describes | Lives on |
 * |---|---|---|
 * | `REFUND_STATUS` | how much of a payment has gone back | `Transaction` |
 * | `REFUND_REQUEST_STATUS` | where one request has reached | `RefundRequest` |
 *
 * One payment can carry several requests — a partial today, another next week.
 * Collapsing the two would make "this request was rejected" and "this payment
 * has nothing refunded" the same fact, which they are not.
 */

/**
 * Where a request has reached.
 *
 * ```
 * REQUESTED
 *   → VENDOR_APPROVED → ADMIN_APPROVED → PROCESSING → COMPLETED   ← normal
 *                                                   → FAILED
 *   → VENDOR_REJECTED ┐
 *   → VENDOR_TIMEOUT  ┘→ ADMIN_OVERRIDE (rare, reason required)   ← exception
 *   → CANCELLED                          ← the customer withdrew it
 * ```
 *
 * **The vendor approves and the admin executes.** The admin is not a second
 * gate on the normal path — an override is a separate route that is logged and
 * counted separately, so a rising override count says the problem is elsewhere.
 *
 * A silent vendor cannot hold a customer's money: after
 * `refund.vendorApprovalHours` the request escalates on its own.
 */
const REFUND_REQUEST_STATUS = Object.freeze({
  REQUESTED: "REQUESTED",
  VENDOR_APPROVED: "VENDOR_APPROVED",
  VENDOR_REJECTED: "VENDOR_REJECTED",
  VENDOR_TIMEOUT: "VENDOR_TIMEOUT",
  ADMIN_APPROVED: "ADMIN_APPROVED",
  ADMIN_REJECTED: "ADMIN_REJECTED",
  ADMIN_OVERRIDE: "ADMIN_OVERRIDE",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
});

/**
 * States a request can still move out of.
 *
 * A denormalised list rather than a computed one, because it is used as a query
 * filter in three places — the vendor's worklist, the escalation job, and the
 * "is there already an open request" check that stops a customer filing five.
 */
const REFUND_OPEN_STATUSES = Object.freeze([
  REFUND_REQUEST_STATUS.REQUESTED,
  REFUND_REQUEST_STATUS.VENDOR_APPROVED,
  REFUND_REQUEST_STATUS.VENDOR_TIMEOUT,
  REFUND_REQUEST_STATUS.ADMIN_APPROVED,
  REFUND_REQUEST_STATUS.PROCESSING,
  // FAILED is open on purpose: the money still has to go back, and the request
  // is what the admin retries from.
  REFUND_REQUEST_STATUS.FAILED,
]);

/**
 * Terminal states where the money is **not** going anywhere.
 *
 * ⚠️ These are exactly the states that must release `Transaction.settlementHold`.
 *
 * The hold goes on the moment a refund is requested, so a refund can never
 * reach money already paid out. The cost is that a hold nobody releases keeps a
 * vendor's money out of **every future settlement** — silently, because the
 * eligibility predicate simply stops matching. There is no error to notice.
 *
 * `FAILED` and `COMPLETED` are deliberately absent: after a failure the money
 * still has to go back, and after completion it is not the vendor's any more.
 */
const REFUND_HOLD_RELEASING_STATUSES = Object.freeze([
  REFUND_REQUEST_STATUS.VENDOR_REJECTED,
  REFUND_REQUEST_STATUS.ADMIN_REJECTED,
  REFUND_REQUEST_STATUS.CANCELLED,
]);

/** Who moved it. A job has no person behind it, so SYSTEM is a real answer. */
const REFUND_ACTOR = Object.freeze({
  CUSTOMER: "CUSTOMER",
  VENDOR: "VENDOR",
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM",
});

/**
 * Why the customer says they want their money back.
 *
 * A closed list rather than free text, because it is the one field a report can
 * actually group by — "40% of refunds at this brand are NOT_HONOURED" is a
 * vendor conversation; a thousand distinct sentences are not. `OTHER` carries
 * the free text, and the validator requires a note with it.
 */
const REFUND_REASON = Object.freeze({
  NOT_HONOURED: "NOT_HONOURED",
  OUTLET_CLOSED: "OUTLET_CLOSED",
  WRONG_AMOUNT: "WRONG_AMOUNT",
  SERVICE_ISSUE: "SERVICE_ISSUE",
  DUPLICATE_PAYMENT: "DUPLICATE_PAYMENT",
  CHANGED_MIND: "CHANGED_MIND",
  OTHER: "OTHER",
});

/**
 * What the customer is told, per state.
 *
 * The internal vocabulary is for the worklist. `VENDOR_TIMEOUT` in particular
 * must never reach the customer — telling them the outlet ignored them invites
 * a fight the platform then has to referee, and it is not information they can
 * act on.
 */
const REFUND_CUSTOMER_LABEL = Object.freeze({
  [REFUND_REQUEST_STATUS.REQUESTED]: "Refund requested",
  [REFUND_REQUEST_STATUS.VENDOR_APPROVED]: "Approved by the outlet",
  [REFUND_REQUEST_STATUS.VENDOR_REJECTED]: "Declined by the outlet",
  [REFUND_REQUEST_STATUS.VENDOR_TIMEOUT]: "Under review by Trydood",
  [REFUND_REQUEST_STATUS.ADMIN_APPROVED]: "Approved — processing",
  [REFUND_REQUEST_STATUS.ADMIN_REJECTED]: "Declined after review",
  [REFUND_REQUEST_STATUS.ADMIN_OVERRIDE]: "Approved by Trydood",
  [REFUND_REQUEST_STATUS.PROCESSING]: "On its way to your account",
  [REFUND_REQUEST_STATUS.COMPLETED]: "Refunded",
  [REFUND_REQUEST_STATUS.FAILED]: "Refund failed — we are on it",
  [REFUND_REQUEST_STATUS.CANCELLED]: "Withdrawn",
});

/**
 * Named so the migration can drop them by name.
 *
 * `syncIndexes()` is never used here — it drops every index not in the current
 * schema, including ones added by hand or by another branch, and names none of
 * them on the way out.
 */
const REFUND_INDEXES = Object.freeze({
  ONE_OPEN_PER_TRANSACTION: "refund_open_per_transaction_unique",
  RAZORPAY_REFUND: "refund_razorpayRefundId_unique",
});

module.exports = {
  REFUND_REQUEST_STATUS,
  REFUND_OPEN_STATUSES,
  REFUND_HOLD_RELEASING_STATUSES,
  REFUND_ACTOR,
  REFUND_REASON,
  REFUND_CUSTOMER_LABEL,
  REFUND_INDEXES,
};
