/**
 * The money ledger — append-only, double-entry in spirit.
 *
 * ### Why a ledger at all
 *
 * Without one, "what does this vendor still have coming?" is an aggregation over
 * `transactions`, and every new case adds another clause to it: a refund, a
 * partial refund, a chargeback, a chargeback won back, an adjustment, a withheld
 * reserve. Six months of that and the query *is* the bug — nobody can tell
 * whether a missing clause is an oversight or a deliberate exclusion.
 *
 * With one, the answer is a sum over an index: the vendor's balance is the total
 * of their `VENDOR_PAYABLE` rows. No conditions, no forgotten clause.
 *
 * ### Two hard rules
 *
 * 1. **A ledger row is never updated and never deleted.** A mistake is corrected
 *    by writing the opposite entry with `reversalOf` set, not by editing the
 *    original. An edited row destroys the only record of what was believed at
 *    the time, which is the entire point of keeping one.
 *
 * 2. **The ledger is the truth; everything else is a cache.**
 *    `Settlement.netPayable`, `Transaction.isPaidToVendor` — those are
 *    conveniences. When they disagree with the ledger, the ledger is right and
 *    the other is a bug.
 */

/**
 * Which pot the money belongs to.
 *
 * `VENDOR_PAYABLE` is the only one scoped to a brand — the other three are the
 * platform's own books, and summing them per-brand would be meaningless.
 */
const LEDGER_ACCOUNT = Object.freeze({
  // What we owe a specific brand. The balance customers' payments build up and
  // payouts draw down.
  VENDOR_PAYABLE: "VENDOR_PAYABLE",
  // What Trydood earned: convenience fees, and commission once it is switched on.
  PLATFORM_REVENUE: "PLATFORM_REVENUE",
  // What Trydood spent: the platform's share of a promo, gateway fees.
  PLATFORM_COST: "PLATFORM_COST",
  // GST collected on our own fee, owed onward to the government.
  TAX_PAYABLE: "TAX_PAYABLE",
});

const LEDGER_DIRECTION = Object.freeze({
  CREDIT: "CREDIT",
  DEBIT: "DEBIT",
});

/**
 * What happened.
 *
 * Every type names a real event, never a computation. "The customer paid" is an
 * entry; "the balance changed" is not.
 */
const LEDGER_ENTRY_TYPE = Object.freeze({
  // ---------- at capture ----------
  // The vendor's supply: bill minus the voucher offer.
  COLLECTION: "COLLECTION",
  // The vendor's agreed share of a promo discount.
  VENDOR_PROMO_SHARE: "VENDOR_PROMO_SHARE",
  // Trydood's slab fee.
  CONVENIENCE_FEE: "CONVENIENCE_FEE",
  // Trydood's share of a promo discount.
  PLATFORM_PROMO_COST: "PLATFORM_PROMO_COST",
  /**
   * Razorpay's MDR plus the GST on it.
   *
   * Razorpay settles **net**: a ₹760 payment arrives as roughly ₹742. The vendor
   * is paid on the gross figure, so without this entry the difference comes
   * silently out of the platform's margin and is recorded nowhere. Which account
   * it lands on follows `settlement.gatewayFeeBearer` — `PLATFORM` today.
   */
  GATEWAY_FEE: "GATEWAY_FEE",
  // GST on the convenience fee. Zero while GST is off.
  TAX_COLLECTED: "TAX_COLLECTED",

  // ---------- later ----------
  // Written when a settlement is PAID, not when it is drafted.
  COMMISSION: "COMMISSION",
  REFUND: "REFUND",
  CHARGEBACK: "CHARGEBACK",
  CHARGEBACK_REVERSAL: "CHARGEBACK_REVERSAL",
  RESERVE_HOLD: "RESERVE_HOLD",
  RESERVE_RELEASE: "RESERVE_RELEASE",
  PAYOUT: "PAYOUT",
  PAYOUT_REVERSAL: "PAYOUT_REVERSAL",
  // An admin correction. Always requires a reason.
  MANUAL_ADJUSTMENT: "MANUAL_ADJUSTMENT",
});

/**
 * The entry types written once per transaction, at capture.
 *
 * Enforced by a partial unique index on `{ entryType, transactionId }`, so a
 * replayed webhook or a resumed settle cannot post the same money twice. Types
 * outside this list can legitimately repeat — a transaction may be partially
 * refunded more than once, and adjusted any number of times.
 */
const ONCE_PER_TRANSACTION_TYPES = Object.freeze([
  LEDGER_ENTRY_TYPE.COLLECTION,
  LEDGER_ENTRY_TYPE.VENDOR_PROMO_SHARE,
  LEDGER_ENTRY_TYPE.CONVENIENCE_FEE,
  LEDGER_ENTRY_TYPE.PLATFORM_PROMO_COST,
  LEDGER_ENTRY_TYPE.GATEWAY_FEE,
  LEDGER_ENTRY_TYPE.TAX_COLLECTED,
]);

/**
 * Where each capture-time entry belongs, and which way it moves.
 *
 * A table rather than a chain of ifs at the call site: the account and direction
 * of an entry are properties of the entry type, and deciding them where the
 * entry happens to be written is how two call sites end up disagreeing about
 * which way a refund moves.
 */
const LEDGER_ENTRY_RULES = Object.freeze({
  [LEDGER_ENTRY_TYPE.COLLECTION]: {
    account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
    direction: LEDGER_DIRECTION.CREDIT,
  },
  [LEDGER_ENTRY_TYPE.VENDOR_PROMO_SHARE]: {
    account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
    direction: LEDGER_DIRECTION.DEBIT,
  },
  [LEDGER_ENTRY_TYPE.CONVENIENCE_FEE]: {
    account: LEDGER_ACCOUNT.PLATFORM_REVENUE,
    direction: LEDGER_DIRECTION.CREDIT,
  },
  [LEDGER_ENTRY_TYPE.PLATFORM_PROMO_COST]: {
    account: LEDGER_ACCOUNT.PLATFORM_COST,
    direction: LEDGER_DIRECTION.DEBIT,
  },
  // Account depends on the bearer, so it is decided by the writer. Direction is
  // always a debit: it is money leaving, whoever it leaves.
  [LEDGER_ENTRY_TYPE.GATEWAY_FEE]: {
    account: null,
    direction: LEDGER_DIRECTION.DEBIT,
  },
  [LEDGER_ENTRY_TYPE.TAX_COLLECTED]: {
    account: LEDGER_ACCOUNT.TAX_PAYABLE,
    direction: LEDGER_DIRECTION.CREDIT,
  },
  [LEDGER_ENTRY_TYPE.COMMISSION]: {
    account: LEDGER_ACCOUNT.PLATFORM_REVENUE,
    direction: LEDGER_DIRECTION.CREDIT,
  },
  [LEDGER_ENTRY_TYPE.CHARGEBACK]: {
    account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
    direction: LEDGER_DIRECTION.DEBIT,
  },
  [LEDGER_ENTRY_TYPE.CHARGEBACK_REVERSAL]: {
    account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
    direction: LEDGER_DIRECTION.CREDIT,
  },
  [LEDGER_ENTRY_TYPE.RESERVE_HOLD]: {
    account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
    direction: LEDGER_DIRECTION.DEBIT,
  },
  [LEDGER_ENTRY_TYPE.RESERVE_RELEASE]: {
    account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
    direction: LEDGER_DIRECTION.CREDIT,
  },
  [LEDGER_ENTRY_TYPE.PAYOUT]: {
    account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
    direction: LEDGER_DIRECTION.DEBIT,
  },
  [LEDGER_ENTRY_TYPE.PAYOUT_REVERSAL]: {
    account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
    direction: LEDGER_DIRECTION.CREDIT,
  },
});

const LEDGER_INDEXES = Object.freeze({
  ONCE_PER_TRANSACTION: "ledger_type_transaction_unique",
  /**
   * One row per entry type per refund.
   *
   * ⚠️ `ONCE_PER_TRANSACTION` does not cover a refund and cannot: a payment may
   * be refunded twice, and each refund posts its own set of rows against the
   * same `transactionId`. Without this index a replayed `refund.processed`
   * webhook — which Razorpay does send — books the whole set a second time, and
   * the vendor is clawed back twice for one refund.
   *
   * Keyed on `refundRequestId` rather than the transaction, so two genuine
   * partial refunds each get their own set while neither can be booked twice.
   */
  ONCE_PER_REFUND: "ledger_type_refund_unique",
});

/** What `reconcileLedger` reports when the books disagree. */
const LEDGER_DRIFT_KIND = Object.freeze({
  BALANCE_MISMATCH: "BALANCE_MISMATCH",
  MISSING_COLLECTION: "MISSING_COLLECTION",
  ORPHAN_PAYOUT: "ORPHAN_PAYOUT",
  SETTLEMENT_MISMATCH: "SETTLEMENT_MISMATCH",
});

module.exports = {
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
  LEDGER_ENTRY_TYPE,
  ONCE_PER_TRANSACTION_TYPES,
  LEDGER_ENTRY_RULES,
  LEDGER_INDEXES,
  LEDGER_DRIFT_KIND,
};
