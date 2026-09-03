/**
 * Vendor settlement vocabulary.
 *
 * A settlement is one brand's takings for one period, claimed atomically and
 * then paid. Almost everything difficult about it comes from two facts:
 *
 *  1. **The claim is a lock.** `Transaction.settlementId: null` is what stops a
 *     payment being counted twice, so stamping it is a one-way door — and
 *     nothing but an explicit release opens it again.
 *  2. **Money can stop being eligible after it was claimed.** A refund request or
 *     a chargeback landing between the 02:00 build and the 14:00 payout is not
 *     rare; it is the normal case on a busy brand.
 */

/**
 * Where a settlement has reached.
 *
 * ```
 * DRAFT
 *   → PENDING_APPROVAL
 *       → APPROVED → PROCESSING → PAID
 *                               → FAILED   → APPROVED      (retry in place)
 *                                          → ABANDONED     (release)
 *                               → REVERSED (release, after PAYOUT_REVERSAL)
 *       → ON_HOLD  → PENDING_APPROVAL      (after a rebuild)
 *       → CANCELLED                        (release)
 * ```
 */
const SETTLEMENT_STATUS = Object.freeze({
  /** Shell exists, transactions are being claimed into it. */
  DRAFT: "DRAFT",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  /** An admin has said yes. This is the last point at which exclusion is free. */
  APPROVED: "APPROVED",
  /** Money is leaving. */
  PROCESSING: "PROCESSING",
  PAID: "PAID",
  /**
   * The payout bounced. **Open, not terminal** — a MANUAL_BANK bounce is an
   * ordinary event and the right operation is to fix the account and retry the
   * same settlement, keeping its number and its statement.
   */
  FAILED: "FAILED",
  /** Something that was claimed is no longer eligible. Rebuild, then re-approve. */
  ON_HOLD: "ON_HOLD",
  /** Money went out and came back. Reached only from PAID. */
  REVERSED: "REVERSED",
  CANCELLED: "CANCELLED",
  /** A FAILED settlement nobody will retry. The only way FAILED releases. */
  ABANDONED: "ABANDONED",
  /**
   * ⚠️ Nothing to pay this period — and that is a legitimate outcome, not a
   * failure.
   *
   * `netPayable <= 0` happens two ordinary ways: last cycle's refunds and
   * chargebacks outweigh this cycle's takings, or a quiet brand simply did not
   * cross `minPayoutAmount`.
   *
   * It must **not** become `PAID`. A `PAID` settlement writes a `PAYOUT` ledger
   * entry, and booking a payout for money no bank transfer carried makes
   * `reconcileLedger` shout `LEDGER_DRIFT` without saying which settlement
   * caused it.
   *
   * It releases its rows, and that **is** the carry-forward: eligibility has no
   * `periodStart` floor, so both the takings and the unapplied deductions flow
   * into the next cycle on their own and net off there instead.
   */
  CARRIED_FORWARD: "CARRIED_FORWARD",
});

/**
 * ⚠️ The transitions that exist. Anything else is a 422.
 *
 * Encoded rather than implied, because every edge here carries three side
 * effects that must not be left to a call site to remember: a ledger entry, a
 * release of the claimed rows, and a history row. A status written directly with
 * `updateOne` skips all three, and the row that goes missing is silent — see
 * `SETTLEMENT_RELEASING_STATUSES`.
 */
const ALLOWED_SETTLEMENT_TRANSITIONS = Object.freeze({
  [SETTLEMENT_STATUS.DRAFT]: Object.freeze([
    SETTLEMENT_STATUS.PENDING_APPROVAL,
    /**
     * ⚠️ Straight to `APPROVED` when `settlement.requiresAdminApproval` is off.
     *
     * That setting exists, defaults to `true`, is settable from the admin panel,
     * and its own comment in `constants/customer.js` says *"turning this off
     * auto-approves"* — while **no code read it**. An admin who switched it off
     * to stop payouts queuing behind a person got no auto-approval and no error:
     * every settlement carried on waiting, and the switch that was supposed to
     * fix it did nothing at all.
     *
     * Approving is not paying. `PATCH /settlements/admin/:id/pay` is still a
     * deliberate human action, and `paySettlement` re-checks `needsRevalidation`
     * at that moment — its own note says approval checking the flag *"is not
     * enough"*, because hours pass in that window. So skipping the review step
     * removes a queue, not the guard.
     */
    SETTLEMENT_STATUS.APPROVED,
    // Reached straight from the build when the period nets to nothing — there is
    // no decision for an admin to make about paying zero.
    SETTLEMENT_STATUS.CARRIED_FORWARD,
    SETTLEMENT_STATUS.CANCELLED,
  ]),
  [SETTLEMENT_STATUS.PENDING_APPROVAL]: Object.freeze([
    SETTLEMENT_STATUS.APPROVED,
    // A rebuild after a tainted row was removed can leave nothing to pay.
    SETTLEMENT_STATUS.CARRIED_FORWARD,
    SETTLEMENT_STATUS.ON_HOLD,
    SETTLEMENT_STATUS.CANCELLED,
  ]),
  [SETTLEMENT_STATUS.APPROVED]: Object.freeze([
    SETTLEMENT_STATUS.PROCESSING,
    // An admin can still pull it back before money moves.
    SETTLEMENT_STATUS.ON_HOLD,
    SETTLEMENT_STATUS.CANCELLED,
  ]),
  [SETTLEMENT_STATUS.PROCESSING]: Object.freeze([
    SETTLEMENT_STATUS.PAID,
    SETTLEMENT_STATUS.FAILED,
  ]),
  [SETTLEMENT_STATUS.PAID]: Object.freeze([SETTLEMENT_STATUS.REVERSED]),
  [SETTLEMENT_STATUS.FAILED]: Object.freeze([
    // Retry in place — same settlement, same number, same statement.
    SETTLEMENT_STATUS.APPROVED,
    SETTLEMENT_STATUS.ABANDONED,
  ]),
  [SETTLEMENT_STATUS.ON_HOLD]: Object.freeze([
    SETTLEMENT_STATUS.PENDING_APPROVAL,
    /**
     * ⚠️ A rebuild can empty a settlement out.
     *
     * If every claimed row turned out to be tainted, dropping them leaves
     * nothing to pay — and without this edge the rebuild throws and the
     * settlement is stuck on hold holding no rows, which is the shape of stuck
     * that nothing sweeps.
     */
    SETTLEMENT_STATUS.CARRIED_FORWARD,
    SETTLEMENT_STATUS.CANCELLED,
  ]),
  // Terminal.
  [SETTLEMENT_STATUS.REVERSED]: Object.freeze([]),
  [SETTLEMENT_STATUS.CANCELLED]: Object.freeze([]),
  [SETTLEMENT_STATUS.ABANDONED]: Object.freeze([]),
  [SETTLEMENT_STATUS.CARRIED_FORWARD]: Object.freeze([]),
});

/**
 * ⚠️ States whose arrival **must** release the claimed transactions.
 *
 * The claim lock only points one way: `settlementId: null → S`. Every future
 * cycle's predicate asks for `settlementId: null`, so the moment a settlement
 * leaves the happy path without releasing, those rows become **invisible to
 * every cycle for ever** — no error, no alert, the predicate simply stops
 * matching.
 *
 * One admin click could make ₹92,400 permanently unpayable, and the ledger would
 * stay quiet about it because its own arithmetic is *correct*: no `PAYOUT` entry
 * was ever written, so `VENDOR_PAYABLE` still shows the money as owed. Which it
 * is. It just cannot be reached.
 *
 * `PAID` is deliberately absent: that money left. It releases only through
 * `REVERSED`, and only after a `PAYOUT_REVERSAL` ledger entry — **ledger first,
 * rows second**, so a crash in between leaves an over-stated reversal rather
 * than money that is both paid and claimable.
 *
 * `FAILED` is absent too: the default there is retry-in-place, and releasing on
 * a bounce would scatter the settlement's rows into the next cycle and lose its
 * number and statement. Only `ABANDONED` says nobody will retry.
 */
const SETTLEMENT_RELEASING_STATUSES = Object.freeze([
  SETTLEMENT_STATUS.CANCELLED,
  SETTLEMENT_STATUS.ABANDONED,
  SETTLEMENT_STATUS.REVERSED,
  /**
   * Releasing **is** the carry-forward. The rows and the unapplied deductions
   * flow into the next cycle on their own, because eligibility has no
   * `periodStart` floor, and net off there instead.
   */
  SETTLEMENT_STATUS.CARRIED_FORWARD,
]);

/** States where the rows are still held and the settlement is still going. */
const SETTLEMENT_OPEN_STATUSES = Object.freeze([
  SETTLEMENT_STATUS.DRAFT,
  SETTLEMENT_STATUS.PENDING_APPROVAL,
  SETTLEMENT_STATUS.APPROVED,
  SETTLEMENT_STATUS.PROCESSING,
  SETTLEMENT_STATUS.ON_HOLD,
  SETTLEMENT_STATUS.FAILED,
]);

/**
 * States before the money has left.
 *
 * ⚠️ A risk event landing on a transaction in one of these can still be excluded
 * for free. After `PROCESSING` it cannot — which is why the design line is
 * *"before the settlement is APPROVED"*, not *"before the payout"*.
 */
const SETTLEMENT_PRE_PAYOUT_STATUSES = Object.freeze([
  SETTLEMENT_STATUS.DRAFT,
  SETTLEMENT_STATUS.PENDING_APPROVAL,
  SETTLEMENT_STATUS.APPROVED,
]);

/** Who moved it. A job has no person behind it, so SYSTEM is a real answer. */
const SETTLEMENT_ACTOR = Object.freeze({
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM",
});

/**
 * Why a settlement left the happy path.
 *
 * A closed list because it is the field an admin report groups by — *"nine of
 * this month's failures were a wrong IFSC"* is an operations conversation; nine
 * distinct sentences are not.
 */
const SETTLEMENT_FAILURE_REASON = Object.freeze({
  BANK_REJECTED: "BANK_REJECTED",
  ACCOUNT_INVALID: "ACCOUNT_INVALID",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  GATEWAY_ERROR: "GATEWAY_ERROR",
  OTHER: "OTHER",
});

/**
 * Named so the migration can drop them by name.
 *
 * `syncIndexes()` is never used here — it drops every index not in the current
 * schema, including ones added by hand or by another branch, and names none of
 * them on the way out.
 */
const SETTLEMENT_INDEXES = Object.freeze({
  IDEMPOTENCY: "settlement_idempotency_unique",
  NUMBER: "settlement_number_unique",
  STATEMENT_TOKEN: "settlement_statementToken_unique",
});

/** `TD/STL/26-27/000123`. The `Counter` pattern, same as invoices. */
const SETTLEMENT_NUMBER = Object.freeze({
  PREFIX: "TD/STL",
  PAD: 6,
  COUNTER_KEY: "settlementNumber",
});

module.exports = {
  SETTLEMENT_STATUS,
  ALLOWED_SETTLEMENT_TRANSITIONS,
  SETTLEMENT_RELEASING_STATUSES,
  SETTLEMENT_OPEN_STATUSES,
  SETTLEMENT_PRE_PAYOUT_STATUSES,
  SETTLEMENT_ACTOR,
  SETTLEMENT_FAILURE_REASON,
  SETTLEMENT_INDEXES,
  SETTLEMENT_NUMBER,
};
