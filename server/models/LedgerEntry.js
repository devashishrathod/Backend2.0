const mongoose = require("mongoose");
const {
  brandField,
  transactionField,
  voucherClaimField,
  settlementField,
  refundRequestField,
  userField,
} = require("./validObjectId");
const {
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
  LEDGER_ENTRY_TYPE,
  LEDGER_INDEXES,
} = require("../constants/ledger");
const { CUSTOMER_CURRENCY_DEFAULTS } = require("../constants/customer");

/**
 * One movement of money. Append-only.
 *
 * Rows here are **never updated and never deleted**. A correction is a new row
 * with `reversalOf` pointing at the one it undoes. Editing a row would destroy
 * the record of what was believed at the time, which is the only reason to keep
 * a ledger at all.
 *
 * `isDeleted` exists solely because every collection in this repo has it and a
 * query helper may assume it. **Nothing sets it to true.**
 *
 * ### Amount is always positive
 *
 * The sign lives in `direction`, never in `amount`. A negative amount plus a
 * DEBIT is ambiguous — is it a debit of −₹50, or a mis-signed credit? Keeping
 * amounts positive means a sum is always a sum and the direction is always the
 * question.
 */
const ledgerEntrySchema = new mongoose.Schema(
  {
    entryType: {
      type: String,
      enum: Object.values(LEDGER_ENTRY_TYPE),
      required: true,
      index: true,
    },
    direction: {
      type: String,
      enum: Object.values(LEDGER_DIRECTION),
      required: true,
    },
    // Always positive. See above.
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: CUSTOMER_CURRENCY_DEFAULTS.currency },

    account: {
      type: String,
      enum: Object.values(LEDGER_ACCOUNT),
      required: true,
      index: true,
    },
    /**
     * Required on `VENDOR_PAYABLE`, absent on the platform's own accounts.
     *
     * Enforced in `recordLedgerEntry` rather than by the schema: a
     * `required` that depends on the value of another field is a validator
     * function, and putting the rule in the writer keeps it next to the error
     * message that explains it.
     */
    brandId: { ...brandField, index: true },

    // ---------- what this entry is about ----------
    transactionId: transactionField,
    voucherClaimId: voucherClaimField,
    settlementId: settlementField,
    /**
     * Phase S1 / S3. Declared early so the shape does not change under a
     * collection that is append-only.
     *
     * ⚠️ Written inline it carried **no `ref`**, so `populate()` could not
     * follow it and nothing verified what it pointed at — on a collection where
     * a row is never updated and never deleted, which makes a wrong pointer
     * permanent. `refundRequestField` names `RefundRequest`; there is no
     * `Refund` model and there will not be one.
     */
    refundRequestId: refundRequestField,
    /**
     * ⚠️ Razorpay's own dispute id (`disp_…`), so a **string**.
     *
     * Declared as an `ObjectId`, which it can never be: `Transaction.disputeId`
     * is the string Razorpay sends, and `recordLedgerEntry` already accepts and
     * writes this field — so the first real chargeback entry would have died on
     * a cast error. Unusable as declared, and quietly so, because nothing posted
     * one yet.
     */
    disputeId: { type: String, trim: true },
    payoutLegId: { type: mongoose.Schema.Types.ObjectId },

    /**
     * Human-readable, and the field an accountant actually reads.
     *
     * Carries the things an id cannot: the bank account's last four digits, the
     * UTR of a payout, the promo code behind a share. A row whose narration says
     * "Payout to ••••4471, UTR N123456789" can be matched against a bank
     * statement; one that says `PAYOUT` cannot.
     */
    narration: { type: String, trim: true, maxlength: 500 },
    // When the money moved, which is not always when the row was written — a
    // resumed settle writes today for something that happened yesterday.
    occurredAt: { type: Date, default: Date.now, required: true },

    // The entry this one undoes. Set only on corrections.
    reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" },
    // Required on MANUAL_ADJUSTMENT — an unexplained adjustment is
    // indistinguishable from a mistake.
    reason: { type: String, trim: true, maxlength: 500 },
    createdBy: userField,

    /**
     * Whether this entry may appear only once for its transaction.
     *
     * A denormalised flag, set by `recordLedgerEntry` from
     * `ONCE_PER_TRANSACTION_TYPES` — not a list in the index, because Mongo's
     * `partialFilterExpression` accepts only equality, `$exists`, comparisons
     * and `$type`, and **never `$in`**. "One of these six types" cannot be
     * expressed as a partial filter, so the answer is collapsed into a boolean
     * and the index keys on that. The same reason `VoucherClaim.holdsUsageSlot`
     * exists.
     */
    isOncePerTransaction: { type: Boolean, default: false },

    // Present for shape only. Ledger rows are not deleted.
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

/**
 * A vendor's balance in one index scan.
 *
 * `sum(VENDOR_PAYABLE)` for a brand, and that is the whole query — no status
 * filter, no date window, no clause anyone can forget. That is the reason the
 * ledger exists.
 */
ledgerEntrySchema.index({ brandId: 1, account: 1, occurredAt: -1 });
ledgerEntrySchema.index({ transactionId: 1 });
ledgerEntrySchema.index({ settlementId: 1 });
ledgerEntrySchema.index({ entryType: 1, occurredAt: -1 });
ledgerEntrySchema.index({ voucherClaimId: 1 });

/**
 * One capture-time entry of each type per transaction.
 *
 * This is what makes a replayed webhook or a resumed settle safe: posting
 * `COLLECTION` twice would credit the vendor twice for one payment, and no
 * amount of care at the call site can rule that out on its own.
 *
 * Partial, because the constraint is only true of the capture-time types — a
 * transaction can be partially refunded more than once, and adjusted any number
 * of times. `$type: "objectId"` keeps entries with no transaction out of the
 * index entirely, so two settlement payouts do not collide on a shared null.
 */
/**
 * One row per entry type per refund.
 *
 * `$type: "objectId"` rather than `sparse: true` — sparse still indexes an
 * explicit `null`, so every non-refund row in the collection would collide on a
 * rule that was never meant to apply to it. That is the same bug the legacy
 * `invoiceId_1` index caused, and it actually fired in 1B.
 */
/**
 * One row per entry type per payout leg.
 *
 * `$type: "objectId"` rather than `sparse: true` — sparse still indexes an
 * explicit `null`, so every non-payout row in the collection would collide with
 * the next on a rule that was never meant to apply to it.
 */
ledgerEntrySchema.index(
  { payoutLegId: 1, entryType: 1 },
  {
    name: LEDGER_INDEXES.ONCE_PER_PAYOUT_LEG,
    unique: true,
    partialFilterExpression: { payoutLegId: { $type: "objectId" } },
  },
);

ledgerEntrySchema.index(
  { refundRequestId: 1, entryType: 1 },
  {
    name: LEDGER_INDEXES.ONCE_PER_REFUND,
    unique: true,
    partialFilterExpression: { refundRequestId: { $type: "objectId" } },
  },
);

ledgerEntrySchema.index(
  { entryType: 1, transactionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isOncePerTransaction: true,
      transactionId: { $type: "objectId" },
    },
    name: LEDGER_INDEXES.ONCE_PER_TRANSACTION,
  },
);

/**
 * One row per entry type per **dispute**.
 *
 * ⚠️ Neither of the other two indexes covers a chargeback. `ONCE_PER_TRANSACTION`
 * is for capture-time rows and a payment can be disputed after it was already
 * refunded; `ONCE_PER_REFUND` keys on a refund that does not exist here.
 *
 * Razorpay redelivers dispute webhooks, and its dispute events are **not
 * monotonic** — a `lost` can arrive after a `won`. Without this index a
 * redelivered `payment.dispute.lost` claws the vendor back twice for one
 * chargeback.
 */
ledgerEntrySchema.index(
  { disputeId: 1, entryType: 1 },
  {
    name: LEDGER_INDEXES.ONCE_PER_DISPUTE,
    unique: true,
    // `$type` rather than `sparse`: a sparse index still indexes an explicit
    // `null`, which every non-dispute row carries.
    partialFilterExpression: { disputeId: { $type: "string" } },
  },
);

/**
 * One reversal per entry.
 *
 * ⚠️ `reverseLedgerEntry` sets `isReversal: true`, which is what lets it write a
 * second row of the same type against the same transaction — and that is
 * precisely what takes it out of `ONCE_PER_TRANSACTION`. It passes no
 * `refundRequestId`, no `payoutLegId` and no `disputeId`, so **none** of the
 * other three indexes covered it either: calling it twice for one entry wrote
 * two opposite rows and undid the same money twice over.
 *
 * `reversalOf` is the natural key — an entry has exactly one correction — and
 * it costs nothing to say so.
 */
ledgerEntrySchema.index(
  { reversalOf: 1 },
  {
    name: LEDGER_INDEXES.ONCE_PER_REVERSAL,
    unique: true,
    partialFilterExpression: { reversalOf: { $type: "objectId" } },
  },
);

/**
 * The platform dashboard's own query shape.
 *
 * `getPlatformTotals` matches `account: { $in: [...] }` with an `occurredAt`
 * range and no brand. The plain `{ account: 1 }` index can serve the `$in` and
 * then has to walk every row in those accounts to apply the date range — which
 * is every platform row ever written, growing for ever, on a dashboard load.
 */
ledgerEntrySchema.index(
  { account: 1, occurredAt: -1 },
  { name: LEDGER_INDEXES.PLATFORM_TOTALS },
);

module.exports = mongoose.model("LedgerEntry", ledgerEntrySchema);
