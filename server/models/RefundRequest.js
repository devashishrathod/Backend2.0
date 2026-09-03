const mongoose = require("mongoose");
const {
  customerField,
  userField,
  brandField,
  subBrandField,
  voucherClaimField,
  transactionField,
  settlementField,
} = require("./validObjectId");
const {
  REFUND_REQUEST_STATUS,
  REFUND_OPEN_STATUSES,
  REFUND_REASON,
  REFUND_INDEXES,
} = require("../constants/refund");
const { REFUND_METHODS } = require("../constants/customer");

/**
 * The money split a refund reverses.
 *
 * Frozen when the request is created, not recomputed at execution. A refund
 * approved on Tuesday and executed on Thursday must move exactly what everyone
 * agreed to on Tuesday — reading live settings at execution would let a promo
 * rule change between approval and payout, and the vendor would be docked an
 * amount nobody approved.
 *
 * ### Who bears what (decided 30 Aug 2026)
 *
 * | Part | On a full refund | On a partial |
 * |---|---|---|
 * | `netBill` | back to the customer, clawed back from the vendor | pro-rata |
 * | `convenienceFee` | back to the customer, **we** absorb it | not returned |
 * | `platformPromoCost` | our share, reversed | pro-rata |
 * | `vendorPromoCost` | vendor's share, reversed | pro-rata |
 * | Razorpay MDR | **we absorb it** — Razorpay does not return its fee on a refund | same |
 *
 * The convenience fee comes back on a full refund because a customer who paid
 * ₹810 and gets ₹800 writes a support ticket, and being right about the ₹10 does
 * not make that cheaper. The MDR is simply a loss, and it is recorded as one so
 * it shows up in the ledger rather than quietly eroding margin.
 */
const refundSplitSchema = new mongoose.Schema(
  {
    // What the customer gets back, and the only number Razorpay is told.
    totalRefund: { type: Number, required: true },

    netBillRefund: { type: Number, default: 0 },
    convenienceFeeRefund: { type: Number, default: 0 },
    /**
     * GST charged on the convenience fee, returned with it on a full refund.
     *
     * ⚠️ Missing from the first version of this schema, and Mongoose drops an
     * unknown key in strict mode **silently** — so the helper computed it, the
     * document stored nothing, and `postRefundEntries` had nothing to post. It
     * only bites once GST is switched on, which is exactly the kind of gap that
     * ships fine and surfaces a quarter later.
     */
    taxRefund: { type: Number, default: 0 },
    /** Same story: the helper returns it, so the schema has to accept it. */
    commissionReversal: { type: Number, default: 0 },
    /**
     * The vendor's half of that commission, and the GST on it.
     *
     * `commissionReversal` is what **we** give up out of revenue.
     * `commissionDeductionReversal` is what the **vendor** gets credited back —
     * a different number whenever GST sits on top of the commission rather than
     * inside it, because there the vendor was deducted both.
     *
     * ⚠️ Same trap as `taxRefund` above: the helper computes these, and without
     * a schema entry Mongoose would drop them silently, leaving
     * `postRefundEntries` nothing to post and `VENDOR_PAYABLE` short by the
     * commission on every refunded sale — invisible until a rate is set.
     */
    commissionTaxReversal: { type: Number, default: 0 },
    commissionDeductionReversal: { type: Number, default: 0 },

    // Clawed back from the vendor's next settlement. Never recovered directly —
    // the golden rule guarantees this money has not been paid out yet.
    vendorClawback: { type: Number, default: 0 },

    platformPromoReversal: { type: Number, default: 0 },
    vendorPromoReversal: { type: Number, default: 0 },

    /**
     * What Razorpay keeps. Not part of `totalRefund` — it is our loss, recorded
     * so it is visible.
     */
    gatewayFeeAbsorbed: { type: Number, default: 0 },

    isFullRefund: { type: Boolean, default: false },
  },
  { _id: false },
);

const refundRequestSchema = new mongoose.Schema(
  {
    // ---------- what is being refunded ----------
    claimId: { ...voucherClaimField, required: true, index: true },
    transactionId: { ...transactionField, required: true, index: true },
    customerId: { ...customerField, required: true, index: true },
    brandId: { ...brandField, required: true, index: true },
    subBrandId: subBrandField,

    /**
     * The claim code, copied.
     *
     * Denormalised on purpose: every worklist shows it, support quotes it, and
     * a vendor searches by it. Joining `VoucherClaim` for one string on every
     * row of every list is the kind of lookup that is invisible until the list
     * is long.
     */
    claimCode: { type: String, trim: true, uppercase: true, index: true },

    // ---------- amounts ----------
    /**
     * What the customer asked for. Never overwritten — an approval that lowers
     * the amount writes `approvedAmount`, so the difference stays visible.
     */
    requestedAmount: { type: Number, required: true },

    /**
     * What was actually approved, and what will be paid.
     *
     * ⚠️ May be **lower** than `requestedAmount`, never higher. Refunding more
     * than the customer asked for is a new decision, not an approval of theirs,
     * and the service refuses it — a fat-fingered extra zero at the approval
     * step would otherwise pay out ten times the claim.
     */
    approvedAmount: { type: Number },

    split: { type: refundSplitSchema, default: undefined },

    // ---------- where it is ----------
    status: {
      type: String,
      enum: Object.values(REFUND_REQUEST_STATUS),
      default: REFUND_REQUEST_STATUS.REQUESTED,
      required: true,
      index: true,
    },

    /**
     * Denormalised "still moving", because Mongo's `partialFilterExpression`
     * accepts only equality, `$exists`, comparisons and `$type` — **never
     * `$in`**. "In one of these six statuses" cannot be a partial filter, so it
     * collapses into this flag and the unique index keys on it.
     *
     * Kept in step by `syncOpenFlag()` below rather than at each call site.
     */
    isOpen: { type: Boolean, default: true },

    reason: {
      type: String,
      enum: Object.values(REFUND_REASON),
      required: true,
    },
    // Required by the validator when `reason` is OTHER.
    reasonNote: { type: String, trim: true, maxlength: 500 },

    method: {
      type: String,
      enum: Object.values(REFUND_METHODS),
      default: REFUND_METHODS.SOURCE,
    },

    // ---------- MANUAL_BANK — only when SOURCE cannot deliver ----------
    /**
     * When an admin asked the customer for an account, and when they answered.
     *
     * Both stored because the gap between them is the only thing that says
     * whether a stalled refund is waiting on us or on them — and that decides
     * whether the right action is to chase the customer or to look at our own
     * queue. Without it, `AWAITING_BANK_DETAILS` for three weeks looks identical
     * whether we asked yesterday or last month.
     */
    bankDetailsRequestedAt: { type: Date },
    bankDetailsProvidedAt: { type: Date },
    /**
     * How many nudges the customer has had about supplying an account, and the
     * claim that stops two instances sending the same one.
     *
     * ⚠️ Its own counter, not `remindersSent`. That one belongs to the vendor's
     * approval window; sharing it would mean a refund that had already nudged
     * the outlet twice silently skipped both of the customer's.
     *
     * The last stage is not a reminder at all — it hands the row to an admin.
     */
    bankDetailsRemindersSent: { type: Number, default: 0 },
    /**
     * The account this refund is going to.
     *
     * A reference, not a copy: the payee is frozen onto the `PayoutLeg` at the
     * moment the money is sent, exactly as a settlement freezes
     * `bankSnapshot`. Copying it here as well would give two records of the same
     * fact that can disagree, and the one that matters in a dispute is the one
     * attached to the transfer.
     */
    customerBankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CustomerBankAccount",
    },

    // ---------- the vendor's decision ----------
    vendorDecisionBy: userField,
    vendorDecisionAt: { type: Date },
    vendorNote: { type: String, trim: true, maxlength: 500 },
    /**
     * When the vendor's window runs out.
     *
     * Stored rather than computed from `createdAt + settings`, so the escalation
     * job can index on it, and so raising the setting tomorrow does not silently
     * extend every request already waiting.
     */
    vendorRespondBy: { type: Date, index: true },
    remindersSent: { type: Number, default: 0 },

    // ---------- the admin's decision ----------
    adminDecisionBy: userField,
    adminDecisionAt: { type: Date },
    adminNote: { type: String, trim: true, maxlength: 500 },
    /**
     * True when the admin approved something the vendor rejected or ignored.
     *
     * Counted separately in reporting: a rising override rate does not mean
     * admins are being generous, it means something upstream is wrong — an
     * outlet that never responds, or a voucher that cannot be honoured.
     */
    isOverride: { type: Boolean, default: false },
    overrideReason: { type: String, trim: true, maxlength: 500 },

    // ---------- execution ----------
    /**
     * Razorpay's refund id.
     *
     * Unique among the rows that have one, which is what makes the executor
     * safe to run twice: the second attempt loses on the index instead of
     * issuing a second refund.
     */
    razorpayRefundId: { type: String, trim: true },
    // Razorpay returns the bank reference on `acquirer_data.arn`. The customer
    // will quote this to their bank, so it is the one field support needs.
    utr: { type: String, trim: true },
    speed: { type: String, trim: true },

    initiatedAt: { type: Date },
    completedAt: { type: Date },
    failedAt: { type: Date },
    failureReason: { type: String, trim: true, maxlength: 500 },
    /**
     * Retries of a failed refund. A refund that has failed several times is not
     * a transient error — it is usually an instrument that cannot receive money
     * back, which is exactly when `MANUAL_BANK` becomes the answer.
     */
    attemptCount: { type: Number, default: 0 },

    /**
     * Which vendor settlement absorbed this refund's deduction.
     *
     * Filled by `buildSettlements` when it claims the refund, not here. Answers
     * "which payout did this come out of?" in one query, from either side.
     */
    settlementId: settlementField,

    /**
     * Written off — this clawback is never coming back, and we have said so.
     *
     * ### ⚠️ Why a refund needs this as much as a chargeback does
     *
     * The deduction for a completed refund is claimed by the next settlement.
     * If the brand's deductions outrun their takings, `netPayable` goes negative,
     * the settlement goes `CARRIED_FORWARD` — and carrying forward **is**
     * releasing every claim it held. The next cycle re-claims the same rows,
     * reaches the same negative, and carries forward again.
     *
     * While the brand still trades that is exactly right: new sales net it off.
     * It becomes a trap the day they stop. The debt is unreachable, the loop is
     * silent, and the money sits on our books as a receivable from somebody who
     * is not coming back.
     *
     * Marked here, this refund leaves the claim filter for good. The matching
     * `MANUAL_ADJUSTMENT` pair is what keeps the ledger honest about who ate it —
     * see `services/settlements/writeOffVendorDebt.js`.
     */
    writtenOffAt: { type: Date },
    writtenOffBy: { ...userField },
    writtenOffReason: { type: String, trim: true, maxlength: 500 },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

/**
 * Keep `isOpen` honest.
 *
 * A denormalised flag that a call site can forget to update is worse than no
 * flag: the unique index below depends on it, so a stale `true` blocks the
 * customer from ever filing again, and a stale `false` lets them file five.
 * Deriving it from `status` on every save means neither can drift.
 */
refundRequestSchema.pre("save", function syncOpenFlag() {
  this.isOpen = REFUND_OPEN_STATUSES.includes(this.status);
});

/**
 * ⚠️ One open request per payment.
 *
 * Without this a customer tapping twice, or refreshing a stuck page, files two
 * requests against the same payment — and if both are approved the payment is
 * refunded twice. The unique index decides, not the read-then-write check in
 * front of it.
 *
 * Partial on `isOpen: true` so a settled request does not block the next one:
 * a customer refunded ₹300 in August may legitimately ask for another in
 * September.
 */
refundRequestSchema.index(
  { transactionId: 1, isOpen: 1 },
  {
    name: REFUND_INDEXES.ONE_OPEN_PER_TRANSACTION,
    unique: true,
    partialFilterExpression: { isOpen: true },
  },
);

/**
 * `$type: "string"` rather than `sparse: true`.
 *
 * Sparse still indexes an explicit `null`, so the second request to be created
 * before execution — both carrying `razorpayRefundId: null` — would collide on
 * a uniqueness rule that was never meant to apply to them.
 */
refundRequestSchema.index(
  { razorpayRefundId: 1 },
  {
    name: REFUND_INDEXES.RAZORPAY_REFUND,
    unique: true,
    partialFilterExpression: { razorpayRefundId: { $type: "string" } },
  },
);

// The vendor's worklist: oldest first, because the oldest is closest to timing
// out and a customer has been waiting longest for it.
refundRequestSchema.index({ brandId: 1, status: 1, createdAt: 1 });
// The customer's own list.
refundRequestSchema.index({ customerId: 1, createdAt: -1 });
// The escalation job: whose window has run out.
refundRequestSchema.index({ status: 1, vendorRespondBy: 1 });
// The admin worklist and the settlement's "which refunds are still unclaimed".
refundRequestSchema.index({ status: 1, settlementId: 1 });

module.exports = mongoose.model("RefundRequest", refundRequestSchema);
