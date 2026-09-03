const mongoose = require("mongoose");
const {
  brandField,
  transactionField,
  userField,
  settlementField,
} = require("./validObjectId");
const {
  SETTLEMENT_STATUS,
  SETTLEMENT_OPEN_STATUSES,
  SETTLEMENT_FAILURE_REASON,
  SETTLEMENT_INDEXES,
} = require("../constants/settlement");
const {
  SETTLEMENT_CYCLE_TYPES,
  PAYOUT_PROVIDERS,
} = require("../constants/customer");

/**
 * The bank account as it stood when the settlement was approved.
 *
 * Frozen, and read by the payout executor instead of the live account. A vendor
 * editing their bank details between approval and NEFT would otherwise redirect
 * a payout that a person had already signed off — and NEFT has **no recall**.
 *
 * The same discipline the invoice generator follows: no lookups at render time.
 */
const bankSnapshotSchema = new mongoose.Schema(
  {
    accountHolderName: { type: String, trim: true },
    maskedAccountNumber: { type: String, trim: true },
    accountLast4Digits: { type: String, trim: true },
    ifscCode: { type: String, trim: true, uppercase: true },
    bankName: { type: String, trim: true },
    bankId: { type: mongoose.Schema.Types.ObjectId },
    verifiedAt: { type: Date },
  },
  { _id: false },
);

const settlementSchema = new mongoose.Schema(
  {
    /** `TD/STL/26-27/000123`. Document of record — never reused, never reissued. */
    settlementNumber: { type: String, trim: true },
    brandId: { ...brandField, required: true, index: true },

    bankSnapshot: { type: bankSnapshotSchema, default: undefined },

    // ---------- the period ----------
    /**
     * ⚠️ Both are **canonical IST day boundaries**, never derived from
     * `new Date()`.
     *
     * `jobs/index.js` runs every job once at boot and the runner is
     * per-process, so a restart or a second instance means `buildSettlements`
     * runs again. `idempotencyKey` only protects anything if `periodEnd` is
     * *exactly* the same value both times — see `helpers/dates/istDate.js`.
     */
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    cycleType: {
      type: String,
      enum: Object.values(SETTLEMENT_CYCLE_TYPES),
      default: SETTLEMENT_CYCLE_TYPES.DAILY,
    },

    // ---------- the money ----------
    //
    // Every figure is computed from the rows this settlement actually **claimed**,
    // never from a live query. A live query would move under a refund landing
    // mid-build and the totals would not add up to the rows they describe.
    grossCollected: { type: Number, default: 0 },
    vendorPromoCost: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    /**
     * GST on the commission, summed from the frozen per-claim values.
     *
     * ⚠️ `computeTotals` used to write a hardcoded `0` here while the field was
     * already on the model and already shown to the vendor — a number that could
     * only ever be wrong once a rate was set. It is derived now.
     */
    commissionTax: { type: Number, default: 0 },
    /**
     * What the vendor was actually deducted: `commissionAmount` plus
     * `commissionTax` only when that tax sits on top rather than inside.
     * `netPayable` is built from this, not from `commissionAmount`.
     */
    commissionDeduction: { type: Number, default: 0 },
    /**
     * Refunds and chargebacks from **earlier** cycles, claimed the same way the
     * transactions are.
     *
     * ⚠️ Computed once and stored, because a figure derived live from "this
     * brand's un-adjusted refunds" would apply the **same deduction in every
     * cycle** — the vendor would be docked for one chargeback again and again.
     * That is why `RefundRequest` carries a `settlementId` too.
     */
    refundAdjustment: { type: Number, default: 0 },
    chargebackAdjustment: { type: Number, default: 0 },
    reserveHeld: { type: Number, default: 0 },
    /**
     * The rate actually applied, and why.
     *
     * ### ⚠️ Frozen here, never recomputed
     *
     * `reserveHeld` was stored while the **rate** was not, which was fine only
     * while every brand paid the same one. Once the rate is chosen per brand
     * from a trailing chargeback window, that window has moved by the time
     * anybody reads the statement — so *"why was 15% withheld from me in
     * March?"* would be answered by recomputing today's number, which is a
     * different number, and the arithmetic on the page would not reproduce.
     *
     * The same discipline `computeTotals` already follows: a settlement's
     * figures must add up to the rows it claims to describe, and a live query is
     * how that quietly stops being true.
     *
     * `reserveBasis` carries the reasoning rather than just the result, because
     * *"you had 4 chargebacks in 260 sales over 180 days"* is an answer and
     * *"15%"* is not.
     */
    reservePercent: { type: Number, default: 0, min: 0, max: 100 },
    reserveBasis: {
      /** `RESERVE_BASIS` — see `helpers/settlements/reserveRisk.js`. */
      reason: { type: String, trim: true },
      disputeCount: { type: Number, default: 0 },
      paymentCount: { type: Number, default: 0 },
      disputeRatePercent: { type: Number, default: 0 },
      lookbackDays: { type: Number, default: 0 },
    },
    /**
     * Matured reserves from **earlier** settlements, added back into this one.
     *
     * ⚠️ This was written as a hardcoded `0` by `computeTotals` while
     * `reserveHeld` was fully wired — the third field in this system to have that
     * shape, after `chargebackAdjustment` and `commissionTax`, and the same
     * consequence: with the reserve switched on, money went in and **never came
     * out**. Invisible today only because `reserve.isEnabled` is `false`.
     */
    reserveReleased: { type: Number, default: 0 },
    /**
     * Which later settlement claimed **this** settlement's reserve.
     *
     * The claim lock, the same discipline `chargebackSettlementId` uses on a
     * transaction. Without it, a live "matured reserves for this brand" query
     * would hand the same reserve back in **every** cycle — for ever — and each
     * month's arithmetic would look internally consistent.
     */
    reserveReleaseSettlementId: { ...settlementField },
    reserveReleasedAt: { type: Date },

    /**
     * When the payout was actually confirmed.
     *
     * ⚠️ The settlement carried `approvedAt` and nothing else — so it recorded
     * when somebody said yes, but not when the vendor was paid. `paidAt` lived
     * only on the `PayoutLeg`, which means "when did this vendor get their
     * money" needed a join, and a `distinct` over it was not practical at all.
     *
     * The reserve's hold clock runs from here: the hold exists to cover
     * chargebacks that arrive **after** the money left, so it has to start when
     * it left — not when the period closed, and not when an admin approved it.
     */
    paidAt: { type: Date },
    netPayable: { type: Number, default: 0 },
    transactionCount: { type: Number, default: 0 },

    // ---------- where it is ----------
    status: {
      type: String,
      enum: Object.values(SETTLEMENT_STATUS),
      default: SETTLEMENT_STATUS.DRAFT,
      required: true,
      index: true,
    },
    /**
     * Denormalised "still holding rows", because Mongo's
     * `partialFilterExpression` accepts only equality, `$exists`, comparisons
     * and `$type` — **never `$in`**. Kept in step by the pre-save hook below
     * rather than at each call site.
     */
    isOpen: { type: Boolean, default: true },

    payoutProvider: {
      type: String,
      enum: Object.values(PAYOUT_PROVIDERS),
      default: PAYOUT_PROVIDERS.MANUAL_BANK,
    },

    approvedBy: userField,
    approvedAt: { type: Date },

    /**
     * ⚠️ Something claimed by this settlement stopped being eligible.
     *
     * `settlementHold` is only a **pre-claim** filter: once `buildSettlements`
     * has stamped `settlementId`, setting the hold has no effect on this
     * settlement at all — eligibility was evaluated at claim time and the
     * compute step reads only what it captured.
     *
     * The window between the 02:00 build and a 14:00 payout is hours long, and
     * that is exactly when a `dispute.created` or a refund request lands. So the
     * webhook flags the settlement instead, and **approval is the authority**: it
     * is conditional on `needsRevalidation` being unset.
     */
    needsRevalidation: { type: Boolean, default: false },
    taintedTransactionIds: { type: [transactionField], default: undefined },

    // ---------- outcome ----------
    failureReason: {
      type: String,
      enum: Object.values(SETTLEMENT_FAILURE_REASON),
    },
    failureNote: { type: String, trim: true, maxlength: 500 },
    /**
     * Retries of a bounced payout. A settlement that has failed several times is
     * usually a wrong account rather than a transient error — which is when
     * `ABANDONED` and a rebuild become the right answer.
     */
    attemptCount: { type: Number, default: 0 },

    /**
     * How many "this payout is overdue" alerts have gone to an admin.
     *
     * A counter rather than a timestamp, and bumped in the **same update that
     * claims the row** with its expected value in the filter — so two instances
     * reading the same sweep batch cannot both send. The refund reminders learned
     * this the expensive way: a `$lte` filter re-read the row the previous query
     * had just bumped and fired the same nudge twice a millisecond apart, which
     * reads as a broken system rather than a helpful one.
     */
    overdueAlertsSent: { type: Number, default: 0 },

    statementUrl: { type: String, trim: true },
    /** Unguessable handle for the public statement link, like `invoiceToken`. */
    statementToken: { type: String, trim: true },

    /**
     * `STL:<brandId>:<periodEnd>` — one settlement per brand per period.
     *
     * ⚠️ **No attempt counter in the key.** That would be a read-then-write race,
     * and worse: a plain retry of a half-finished daily job would build a
     * *second* settlement for the same day. A released settlement's rows flow
     * into the next cycle on their own, because eligibility has no `periodStart`
     * floor. A genuine same-period rebuild voids the dead key instead —
     * `STL:VOID:<settlementNumber>`.
     */
    idempotencyKey: { type: String, trim: true, required: true },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

/**
 * Keep `isOpen` honest.
 *
 * Derived from `status` on every save, so a call site cannot forget it. A stale
 * value here would make the "which settlements still hold rows" sweep miss a
 * settlement that does — which is the sweep that exists to stop money going
 * permanently unpayable.
 */
settlementSchema.pre("save", function syncOpenFlag() {
  this.isOpen = SETTLEMENT_OPEN_STATUSES.includes(this.status);
});

/**
 * ⚠️ One settlement per brand per period.
 *
 * The runner starts every job once at boot and is per-process, so this index —
 * not the job's own care — is what stops a restart or a second instance building
 * the same day twice.
 */
settlementSchema.index(
  { idempotencyKey: 1 },
  { name: SETTLEMENT_INDEXES.IDEMPOTENCY, unique: true },
);

/**
 * `$type: "string"` rather than `sparse: true` on both of these.
 *
 * Sparse still indexes an explicit `null`, so every DRAFT shell — none of which
 * has a number or a token yet — would collide with the next on a rule that was
 * never meant to apply to them. That is the bug the legacy `invoiceId_1` index
 * caused, and it actually fired in 1B.
 */
settlementSchema.index(
  { settlementNumber: 1 },
  {
    name: SETTLEMENT_INDEXES.NUMBER,
    unique: true,
    partialFilterExpression: { settlementNumber: { $type: "string" } },
  },
);

settlementSchema.index(
  { statementToken: 1 },
  {
    name: SETTLEMENT_INDEXES.STATEMENT_TOKEN,
    unique: true,
    partialFilterExpression: { statementToken: { $type: "string" } },
  },
);

// A vendor's own history, newest first.
settlementSchema.index({ brandId: 1, periodEnd: -1 });
// The admin worklist, and stuck detection.
settlementSchema.index({ status: 1, createdAt: -1 });
// The sweep: settlements still holding rows, oldest first.
settlementSchema.index({ isOpen: 1, createdAt: 1 });

module.exports = mongoose.model("Settlement", settlementSchema);
