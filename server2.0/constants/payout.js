/**
 * Payout vocabulary — money leaving Trydood.
 *
 * Shared by vendor settlements and customer refunds, because a `MANUAL_BANK`
 * refund is the same operation with a different payee: an admin sends a NEFT and
 * types in a UTR. One vocabulary means one adapter, one reconcile job, and one
 * place a UTR lives.
 */

const PAYOUT_TYPE = Object.freeze({
  SETTLEMENT: "SETTLEMENT",
  REFUND: "REFUND",
});

/**
 * Where one leg of a payout has reached.
 *
 * ```
 * INITIATED → PAID
 *           → FAILED    → (a new leg, not a mutation of this one)
 *           → REVERSED  (the bank pulled it back after it landed)
 * ```
 *
 * ⚠️ A failed leg is **never retried in place**. A retry is a new leg with the
 * next `legNumber`, so the record keeps both attempts — the one that bounced and
 * the one that worked, each with its own UTR and its own payee snapshot. Editing
 * the failed leg would erase the fact that money was ever sent to the first
 * account, which is exactly what an investigation needs.
 */
const PAYOUT_LEG_STATUS = Object.freeze({
  INITIATED: "INITIATED",
  PAID: "PAID",
  FAILED: "FAILED",
  REVERSED: "REVERSED",
});

/** Legs that are still moving, or still owed a resolution. */
const PAYOUT_OPEN_STATUSES = Object.freeze([
  PAYOUT_LEG_STATUS.INITIATED,
]);

/** How the money went. Recorded, never inferred from the amount. */
const PAYOUT_MODE = Object.freeze({
  IMPS: "IMPS",
  NEFT: "NEFT",
  RTGS: "RTGS",
  UPI: "UPI",
});

/**
 * Named so a migration can drop them by name.
 *
 * `syncIndexes()` is never used here — it drops every index not in the current
 * schema, including ones added by hand or by another branch, and names none of
 * them on the way out.
 */
const PAYOUT_INDEXES = Object.freeze({
  SETTLEMENT_LEG: "payout_settlement_leg_unique",
  REFUND_LEG: "payout_refund_leg_unique",
});

module.exports = {
  PAYOUT_TYPE,
  PAYOUT_LEG_STATUS,
  PAYOUT_OPEN_STATUSES,
  PAYOUT_MODE,
  PAYOUT_INDEXES,
};
