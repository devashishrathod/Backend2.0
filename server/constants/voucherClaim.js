/**
 * A customer's claim on a voucher — the money-in side of the claim flow.
 *
 * One state machine serves both phases. Phase 1 captures straight to `REDEEMED`
 * because payment happens at the counter and there is nothing left to redeem;
 * Phase 2 stops the same capture at `PAID` and waits for an outlet scan. That is
 * a **behaviour switch, not a migration** — no status is added or removed when
 * Phase 2 arrives.
 */
const VOUCHER_CLAIM_STATUS = Object.freeze({
  // Order created, money not taken. Swept if the customer walks away.
  PENDING: "PENDING",
  // Captured. Phase 2 rests here until the outlet scans the code.
  PAID: "PAID",
  // The discount has been given. Phase 1 lands here directly on capture.
  REDEEMED: "REDEEMED",
  // The gateway refused, or the customer abandoned and the sweep closed it.
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  // Phase 2: paid but never scanned inside the redemption window.
  EXPIRED: "EXPIRED",
  REFUNDED: "REFUNDED",
});

/**
 * Statuses in which the claim still holds its once-per-user slot.
 *
 * Not used in the partial index — `partialFilterExpression` accepts only
 * equality, `$exists`, comparisons and `$type`, never `$in`. The index keys on
 * the denormalised `holdsUsageSlot` boolean instead, and this list is what the
 * code that maintains that boolean is derived from.
 */
const CLAIM_SLOT_HOLDING_STATUSES = Object.freeze([
  VOUCHER_CLAIM_STATUS.PENDING,
  VOUCHER_CLAIM_STATUS.PAID,
  VOUCHER_CLAIM_STATUS.REDEEMED,
]);

/** ...and the ones that hand it back. */
const CLAIM_SLOT_RELEASING_STATUSES = Object.freeze([
  VOUCHER_CLAIM_STATUS.FAILED,
  VOUCHER_CLAIM_STATUS.CANCELLED,
  VOUCHER_CLAIM_STATUS.EXPIRED,
  VOUCHER_CLAIM_STATUS.REFUNDED,
]);

/**
 * How the discount reaches the customer.
 *
 * `AUTO` is Phase 1: paying at the counter *is* the redemption. `OUTLET_SCAN`
 * is Phase 2, where the claim code is shown and scanned. `ADMIN` covers a
 * manual grant or a support correction.
 */
const CLAIM_REDEMPTION_MODE = Object.freeze({
  AUTO: "AUTO",
  OUTLET_SCAN: "OUTLET_SCAN",
  ADMIN: "ADMIN",
});

/**
 * The modes the running code can actually carry to a finished state.
 *
 * ⚠️ **This is the enum's safety catch, and it is deliberately smaller than the
 * enum.** `CLAIM_REDEMPTION_MODE` describes every mode the design has a name
 * for; this describes the ones that have working code behind them *today*.
 *
 * Anything outside `AUTO` needs two things that do not exist yet: an endpoint
 * that moves a scanned claim from `PAID` to `REDEEMED`, and a sweep that closes
 * one nobody scanned. Without them a claim in such a mode is captured — the
 * money is taken — and then sits at `PAID` for ever, with nothing to move it and
 * nothing to complain. Money quietly stuck is the worst shape a bug can take
 * here, because nothing surfaces it.
 *
 * When Phase 2 lands (Appendix C4), add `OUTLET_SCAN` here **in the same commit**
 * as the redeem endpoint and the expiry sweep — never before.
 */
const IMPLEMENTED_REDEMPTION_MODES = Object.freeze([CLAIM_REDEMPTION_MODE.AUTO]);

/**
 * The mode every claim is created in.
 *
 * A named constant rather than a literal at the creation site, so the choice
 * lives with the list that says which choices are safe. `assertRedemptionMode`
 * is what keeps the two honest.
 */
const DEFAULT_REDEMPTION_MODE = CLAIM_REDEMPTION_MODE.AUTO;

/** Whether the running code can finish a claim in this mode. */
const isImplementedRedemptionMode = (mode) =>
  IMPLEMENTED_REDEMPTION_MODES.includes(mode);

/** Append-only audit actions. Mirrors `SUBSCRIPTION_HISTORY_ACTION`. */
const CLAIM_HISTORY_ACTION = Object.freeze({
  CLAIM_CREATED: "CLAIM_CREATED",
  PAYMENT_CAPTURED: "PAYMENT_CAPTURED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  REDEEMED: "REDEEMED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
  REFUND_REQUESTED: "REFUND_REQUESTED",
  /**
   * The refund's own transitions live here rather than in a separate history
   * collection, because a refund is something that happened **to a claim** —
   * and the claim's timeline is exactly where a customer, a vendor and an admin
   * all go to ask "what happened to this?".
   *
   * A second collection would mean a join to answer that, and two timelines to
   * keep in the same order.
   */
  REFUND_APPROVED: "REFUND_APPROVED",
  REFUND_REJECTED: "REFUND_REJECTED",
  REFUND_ESCALATED: "REFUND_ESCALATED",
  REFUND_CANCELLED: "REFUND_CANCELLED",
  REFUND_FAILED: "REFUND_FAILED",
  REFUNDED: "REFUNDED",
  PROMO_RELEASED: "PROMO_RELEASED",
  /**
   * An admin let a held payment back into the settlement run.
   *
   * ⚠️ Admin-only in the timeline. It names a chargeback outcome or a failed
   * refund and records who decided the vendor keeps the money — a decision
   * about a dispute the customer may still believe they won.
   */
  SETTLEMENT_HOLD_RELEASED: "SETTLEMENT_HOLD_RELEASED",
});

/** Who did it. A job has no user behind it, so SYSTEM is a real answer. */
const CLAIM_PERFORMED_BY = Object.freeze({
  CUSTOMER: "CUSTOMER",
  VENDOR: "VENDOR",
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM",
});

/**
 * The claim code the customer sees.
 *
 * `TD-8F3K2Q`. In Phase 1 it is a reference to quote at the counter or in
 * support; in Phase 2 it becomes the redeem key the outlet scans.
 *
 * The alphabet drops the characters that are misread aloud or mistyped from a
 * screen — `0/O`, `1/I/L`, `5/S`, `2/Z`, `8/B` — because this is a code people
 * read to each other across a counter.
 */
const CLAIM_CODE = Object.freeze({
  PREFIX: "TD",
  LENGTH: 6,
  ALPHABET: "34679ACDEFGHJKMNPQRTUVWXY",
  // Collisions are possible with random codes, however unlikely. The unique
  // index is the guarantee; this is how many times generation retries before
  // giving up.
  MAX_ATTEMPTS: 5,
});

const VOUCHER_CLAIM_INDEXES = Object.freeze({
  USAGE_SLOT: "claim_usageSlot_oncePerUser",
  TRANSACTION: "claim_transaction_unique",
  CLAIM_CODE: "claim_code_unique",
});

/**
 * How each audit action reads on a timeline.
 *
 * The timeline is a **presentation** of the audit trail, not a dump of it, and
 * that distinction is load-bearing:
 *
 *  - `snapshot` is `Mixed` and holds whatever mattered at the time — including
 *    the entire pricing block, `platformPromoCost` and all. Rendering it raw on
 *    a vendor's page hands them our margin through the back door, past the
 *    projection that exists to hide it.
 *  - `reason` is free text written by staff **for staff**. "Refunded, customer
 *    disputes the bill amount" is a sentence you cannot safely render to the
 *    customer it is about.
 *
 * So both are admin-only, and everyone else gets a sentence derived from the
 * action. The audit trail stays complete for forensics; the page stays safe by
 * construction rather than by remembering to strip a field.
 */
const CLAIM_TIMELINE_LABEL = Object.freeze({
  [CLAIM_HISTORY_ACTION.CLAIM_CREATED]: "Voucher claim started",
  [CLAIM_HISTORY_ACTION.PAYMENT_CAPTURED]: "Payment received",
  [CLAIM_HISTORY_ACTION.PAYMENT_FAILED]: "Payment failed",
  [CLAIM_HISTORY_ACTION.REDEEMED]: "Redeemed at the outlet",
  [CLAIM_HISTORY_ACTION.EXPIRED]: "Voucher expired",
  [CLAIM_HISTORY_ACTION.CANCELLED]: "Claim cancelled",
  [CLAIM_HISTORY_ACTION.REFUND_REQUESTED]: "Refund requested",
  [CLAIM_HISTORY_ACTION.REFUND_APPROVED]: "Refund approved",
  [CLAIM_HISTORY_ACTION.REFUND_REJECTED]: "Refund declined",
  // Deliberately not "the outlet did not respond". Telling a customer the
  // outlet ignored them starts a fight the platform then has to referee, and
  // it is not something they can act on.
  [CLAIM_HISTORY_ACTION.REFUND_ESCALATED]: "Refund under review by Trydood",
  [CLAIM_HISTORY_ACTION.REFUND_CANCELLED]: "Refund request withdrawn",
  [CLAIM_HISTORY_ACTION.REFUND_FAILED]: "Refund failed",
  [CLAIM_HISTORY_ACTION.REFUNDED]: "Refunded",
  [CLAIM_HISTORY_ACTION.PROMO_RELEASED]: "Promo reservation released",
  [CLAIM_HISTORY_ACTION.SETTLEMENT_HOLD_RELEASED]: "Payment released for settlement",
});

/**
 * Rows nobody but an admin has a reason to read.
 *
 * `PROMO_RELEASED` is our own budget bookkeeping — releasing a reservation
 * against a campaign. It explains nothing to the customer and nothing to the
 * brand, and it names an internal cost split.
 *
 * `SETTLEMENT_HOLD_RELEASED` is the same kind of thing from the other side: it
 * records an admin deciding who bears the loss on a chargeback or a failed
 * refund. The customer may still believe that dispute went their way, and the
 * vendor has no part in the decision — so neither of them reads the row.
 *
 * Everything else is shown to all three audiences. A claim that failed shows
 * `status: FAILED` on the document either way, so hiding the row that explains
 * it would leave the reader with a state and no story.
 */
const CLAIM_TIMELINE_INTERNAL_ACTIONS = Object.freeze([
  CLAIM_HISTORY_ACTION.PROMO_RELEASED,
  CLAIM_HISTORY_ACTION.SETTLEMENT_HOLD_RELEASED,
]);

module.exports = {
  VOUCHER_CLAIM_STATUS,
  CLAIM_SLOT_HOLDING_STATUSES,
  CLAIM_SLOT_RELEASING_STATUSES,
  CLAIM_REDEMPTION_MODE,
  IMPLEMENTED_REDEMPTION_MODES,
  DEFAULT_REDEMPTION_MODE,
  isImplementedRedemptionMode,
  CLAIM_HISTORY_ACTION,
  CLAIM_PERFORMED_BY,
  CLAIM_CODE,
  VOUCHER_CLAIM_INDEXES,
  CLAIM_TIMELINE_LABEL,
  CLAIM_TIMELINE_INTERNAL_ACTIONS,
};
