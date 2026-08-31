const mongoose = require("mongoose");
const {
  brandField,
  transactionField,
  voucherClaimField,
  settlementField,
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
    // Phase S1 / S3. Declared now so the shape does not change under a
    // collection that is append-only.
    refundRequestId: { type: mongoose.Schema.Types.ObjectId },
    disputeId: { type: mongoose.Schema.Types.ObjectId },
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

module.exports = mongoose.model("LedgerEntry", ledgerEntrySchema);
