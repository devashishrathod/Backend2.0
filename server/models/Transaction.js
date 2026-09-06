const mongoose = require("mongoose");
const { isValidEmail, isValidPhoneNumber } = require("../validator/common");
const {
  userField,
  subscriptionField,
  brandField,
  subBrandField,
  customerField,
  voucherField,
  voucherVersionField,
  voucherClaimField,
  settlementField,
  refundRequestField,
  subscribedField,
} = require("./validObjectId");
const { pricingSchema } = require("./pricingSchema");
const { documentSnapshotSchema } = require("./documentSnapshotSchema");
const {
  PAYMENT_STATUS,
  PAYMENT_METHODS,
  WALLET_PROVIDERS,
  REFUND_STATUS,
} = require("../constants");
const {
  PAYMENT_GATEWAYS,
  MANUAL_PAYMENT_MODES,
} = require("../constants/subscription");
const { DISPUTE_STATUS } = require("../constants/webhook");
const {
  RAZORPAY_ACCOUNTS,
  TRANSACTION_PURPOSE,
  SETTLEMENT_STAGE,
  GATEWAY_FEE_BEARER,
  TRANSACTION_INDEXES,
} = require("../constants/transaction");

/**
 * Everything a voucher claim adds to a transaction.
 *
 * Namespaced rather than spread across the top level for one reason: this
 * document already carries 60-plus fields shared by two different money flows,
 * and a reader needs to be able to tell at a glance which ones apply to which.
 * `purpose: VOUCHER_CLAIM` rows fill this in; subscription rows leave it empty.
 *
 * The amounts here are a denormalised copy of `VoucherClaim.pricing`, kept so a
 * settlement can total a brand's day without joining every claim.
 */
const voucherTransactionSchema = new mongoose.Schema(
  {
    claimId: voucherClaimField,
    voucherId: voucherField,
    voucherVersionId: voucherVersionField,
    versionNumber: { type: Number },
    // Plain ObjectId, not voucherOfferField — offers are embedded subdocuments
    // inside VoucherVersion.offers, so there is no model to ref. Null when the
    // bill was below every offer's minimum and the customer simply paid it.
    offerId: { type: mongoose.Schema.Types.ObjectId },

    billAmount: { type: Number },
    offerDiscount: { type: Number, default: 0 },
    convenienceFee: { type: Number, default: 0 },
    // billAmount - offerDiscount. The vendor's supply; GST on it (if any) is
    // the vendor's own, not ours.
    netBill: { type: Number },

    // What the vendor is owed once the promo split is applied. Frozen here so a
    // later change to the promo code cannot rewrite a settled figure.
    vendorPayable: { type: Number },
    platformPromoCost: { type: Number, default: 0 },
    vendorPromoCost: { type: Number, default: 0 },
    // 0 today. Frozen at claim time anyway, because reading the live rate at
    // settlement would let a rate change retroactively dock money from claims
    // already collected and already shown to the vendor.
    commissionPercent: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    // GST on that commission, and what the settlement actually deducts —
    // commission plus tax only when the tax sits on top. Both frozen here for
    // the same reason as the rate. See `models/voucherPricingSchema.js`.
    commissionTax: { type: Number, default: 0 },
    commissionDeduction: { type: Number, default: 0 },
  },
  { _id: false },
);

const transactionSchema = new mongoose.Schema(
  {
    // ---------- what this money was for, and whose account it landed in ----------
    // Both required: `purpose` picks the settlement path and scopes every
    // index; `gatewayAccount` decides which Razorpay secret verifies the
    // payment and which instance issues a refund. Neither may be inferred at
    // call time — see constants/transaction.js.
    purpose: {
      type: String,
      enum: Object.values(TRANSACTION_PURPOSE),
      required: true,
      index: true,
    },
    gatewayAccount: {
      type: String,
      enum: Object.values(RAZORPAY_ACCOUNTS),
      required: true,
      index: true,
    },

    userId: userField,
    brandId: brandField,
    subBrandId: subBrandField,
    customerId: customerField,
    subscriptionId: subscriptionField,
    subscribedId: subscribedField,
    voucherId: voucherField,
    createdBy: userField,
    settlementId: settlementField,
    /**
     * A convenience pointer to the **most recent** request, not the whole story.
     *
     * Named for what it is. The old name — `refundId`, one ObjectId — read as
     * *"the refund"*, so a second partial refund silently orphaned the first and
     * every reader believed the one id it found was complete. The real answer is
     * always `RefundRequest.find({ transactionId })`; `amountRefunded` is the
     * cumulative figure.
     */
    latestRefundRequestId: refundRequestField,

    // Only populated on purpose: VOUCHER_CLAIM.
    voucher: { type: voucherTransactionSchema, default: undefined },

    entity: { type: String },
    amount: { type: Number, required: true },
    // Full tax/discount breakdown behind `amount`. Frozen at order time so the
    // invoice never drifts when a plan's price or the GST rate changes later.
    /**
     * Subscription pricing. `purpose: SUBSCRIPTION` only.
     *
     * ⚠️ No default on purpose. It used to auto-materialise, which meant every
     * voucher-claim row carried a subscription pricing block full of zeroes —
     * and `taxType` defaulting to `IGST` inside it. `buildOrderSummary`'s
     * `buildTaxRows()` branches on exactly that field, so a claim rendered
     * through it would print an IGST row of zero: a tax line on an invoice that
     * has no tax.
     *
     * Both subscription writers (`createSubscribeOrder`, `adminGrantSubscription`)
     * set this explicitly from `calculatePricing`, so nothing relied on the
     * default. A voucher claim prices through `voucherPricingSchema` instead and
     * leaves this absent, which is the honest state.
     */
    pricing: { type: pricingSchema },
    // MANUAL covers admin grants — free, cash, bank transfer, cheque. Those
    // rows have no Razorpay order, which is why razorpayOrderId is sparse.
    gateway: {
      type: String,
      enum: Object.values(PAYMENT_GATEWAYS),
      default: PAYMENT_GATEWAYS.RAZORPAY,
    },
    // Only set when gateway is MANUAL.
    manualPaymentMode: {
      type: String,
      enum: Object.values(MANUAL_PAYMENT_MODES),
    },
    referenceNumber: { type: String, trim: true },
    note: { type: String, trim: true, maxlength: 500 },
    // How long the promo price quoted on this order stands. Set to the same
    // window as the promo reservation, so the two cannot drift apart: without
    // it, the reservation was swept after 30 minutes while the discount stayed
    // frozen here, so a late payment got the discount with nothing recorded
    // against the code.
    promoQuotedUntil: { type: Date },
    dueAmount: { type: Number },
    paidAmount: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    offerId: { type: String },
    currency: { type: String, default: "INR" },
    description: { type: String },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      validate: {
        validator: (email) => isValidEmail(email),
        message: (props) => `${props.value} is not a valid email address`,
      },
    },
    contact: {
      type: String,
      validate: {
        validator: (mobile) => isValidPhoneNumber(mobile),
        message: (props) => `${props.value} is not a valid contact number`,
      },
    },
    status: {
      type: String,
      enum: [...Object.values(PAYMENT_STATUS)],
      default: PAYMENT_STATUS.CREATED,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PAYMENT_METHODS),
    },
    walletProvider: { type: String, enum: WALLET_PROVIDERS },
    // `unique` deliberately NOT declared on the path here — see the named
    // partial-unique indexes at the bottom of this file. A voucher-claim row is
    // inserted before it has an invoice number, and in a non-sparse unique
    // index a missing field is stored as `null`, so only one such row could
    // ever exist. `partialFilterExpression: { $type: "string" }` skips both a
    // missing field and an explicit null; `sparse` would not (it indexes
    // explicit nulls), which is why it is not used.
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String, index: true, sparse: true },
    // Razorpay permits more than one payment attempt against a single order, so
    // a retry after a capture we never recorded can produce two captures. The
    // conditional claim stops the second from settling, but the money is still
    // taken — these are the ids that need refunding. See detectDoubleCapture.
    duplicateCapturePaymentIds: { type: [String], default: undefined },
    razorpaySignature: { type: String },
    invoiceId: { type: String },
    invoiceUrl: { type: String },
    // Unguessable handle for the public invoice download link. The sequential
    // invoice number is a document-of-record and must never appear in a URL.
    documentToken: { type: String },
    // Client-supplied, so a retried create-order returns the same transaction
    // instead of opening a second Razorpay order. Scoped per customer.
    idempotencyKey: { type: String },
    // Everything the document prints, frozen when it is issued. The renderer
    // reads only this and performs no live lookups, so a re-issue reproduces the
    // original exactly — even after the plan is renamed or the seller's GSTIN
    // changes. See models/documentSnapshotSchema.js.
    invoiceSnapshot: { type: documentSnapshotSchema },
    receipt: { type: String, maxlength: 40 },
    amountRefunded: { type: Number, default: 0 },
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date },
    // Razorpay returns an object here on payments and an array on orders, so
    // this has to stay untyped — a typed Array threw CastError on payments.
    notes: { type: mongoose.Schema.Types.Mixed, default: {} },
    fee: { type: Number },
    tax: { type: Number },
    isInternational: { type: Boolean, default: false },
    refundStatus: {
      type: String,
      enum: Object.values(REFUND_STATUS),
      default: REFUND_STATUS.null,
    },
    cardId: { type: String, default: null },
    bank: { type: String, default: null },
    vpa: { type: String, default: null },
    errorCode: { type: String, default: null },
    errorDescription: { type: String, default: null },
    errorSource: { type: String, default: null },
    errorStep: { type: String, default: null },
    errorReason: { type: String, default: null },
    acquirerData: {
      transaction_id: { type: String, default: null },
    },
    createdAtRaw: { type: Number },
    updatedAtRaw: { type: Number },
    paidToVendorAt: { type: Date },
    paidRefundAt: { type: Date },

    // ---------- gateway fee (MDR) ----------
    // Razorpay settles NET: it deducts MDR plus GST on that MDR before the
    // money reaches our bank. `payment.fee` / `payment.tax` already arrive in
    // the capture payload and were already being written to `fee` / `tax`
    // below — what was missing was any notion of who absorbs it, so it was
    // silently coming out of the platform's margin with nothing recorded.
    gatewayFee: { type: Number, default: 0 },
    gatewayFeeBearer: {
      type: String,
      enum: Object.values(GATEWAY_FEE_BEARER),
      default: GATEWAY_FEE_BEARER.PLATFORM,
    },
    // The bearer's share, frozen. Only non-zero when the bearer is not PLATFORM.
    vendorGatewayFee: { type: Number, default: 0 },
    // amount − gatewayFee: what actually reaches the bank, as opposed to what
    // the customer paid. The settlement ledger reconciles against this.
    netReceived: { type: Number },

    // ---------- settlement (money out — see vendor_settlement_plan.md) ----------
    // Set the moment anything makes this row ineligible for payout: a refund
    // request, a completed refund, any dispute event. Monotonic by design — a
    // webhook may set it, only an explicit admin action clears it. Eligibility
    // keys on THIS, never on `isDisputed`, because `payment.dispute.lost`
    // writes `isDisputed: false` and a lost chargeback must not become payable.
    settlementHold: { type: Boolean, default: false, index: true },
    settlementHoldReason: { type: String, trim: true, maxlength: 300 },
    /**
     * When the hold came off, and why.
     *
     * Kept after the release rather than cleared with it. A hold that went on
     * and came off is the most common thing an admin has to explain — *"why was
     * this payout late?"* — and a field that is only ever `null` when correct
     * answers nothing. `reconcileLedger` also reads it to tell a hold that was
     * released from one that was never applied.
     */
    settlementHoldReleasedAt: { type: Date },
    settlementHoldReleaseReason: { type: String, trim: true, maxlength: 300 },
    // Razorpay's own settlement of this payment INTO our bank. Observed, never
    // inferred from a calendar offset: Razorpay settles in T+2 *working* days,
    // and suspends settlement entirely when an account is under review.
    razorpaySettlementId: { type: String, index: true, sparse: true },
    fundsReceivedAt: { type: Date, index: true },

    // ---------- settle progress ----------
    // The conditional claim on `verified` is terminal, but several dependent
    // writes follow it. This is how `resumeIncompleteSettlements` finds a row
    // that was claimed and then abandoned mid-way.
    settlementStage: {
      type: String,
      enum: Object.values(SETTLEMENT_STAGE),
      index: true,
    },
    /**
     * How many times `resumeIncompleteSettlements` has tried and failed, and
     * when it may try again.
     *
     * ⚠️ Without these the sweep took the first 50 stranded rows in natural
     * order with no sort. One row that always throws — corrupt pricing, a
     * deleted voucher — holds its slot on every single run, and once fifty such
     * rows accumulate the job spends every tick failing on the same fifty while
     * newly stranded payments are never reached. This is the repair path for a
     * customer who was charged and got nothing, so starving it is the worst
     * failure this job has.
     *
     * An exponential back-off lets a poisoned row drift to the back of the queue
     * without ever being dropped: it is still retried, just not ahead of a
     * payment that has never been tried at all.
     */
    settlementResumeAttempts: { type: Number, default: 0 },
    settlementResumeAt: { type: Date },
    // Recorded but deliberately NOT settled: an authorized payment is not a
    // captured one. If it stays authorized it is auto-refunded by Razorpay in
    // about five days, which the customer experiences as a silent failure.
    authorizedAt: { type: Date },
    // ---------- chargeback / dispute ----------
    // Mirrored from Razorpay's dispute webhooks. A dispute has a response
    // deadline and missing it forfeits the money, so it is tracked on the
    // transaction rather than left in the webhook log.
    isDisputed: { type: Boolean, default: false },
    disputeStatus: {
      type: String,
      enum: Object.values(DISPUTE_STATUS),
    },
    disputeId: { type: String },
    /**
     * Which settlement has already recovered this chargeback from the vendor.
     *
     * ⚠️ The same lock the refund side uses, and for the same reason. A
     * `chargebackAdjustment` computed live from "this brand's lost disputes"
     * would deduct the **same** chargeback in every cycle, for ever, and each
     * month's arithmetic would look internally consistent while the vendor was
     * charged again and again for one lost dispute.
     */
    /**
     * ⚠️ Superseded by `Dispute.recoverySettlementId`, and kept only so an old
     * row can still be read.
     *
     * The recovery lock lived here — one per payment — while the ledger keyed on
     * the dispute. A payment carrying two lost disputes therefore booked two
     * losses and recovered one, and the second was silently forgiven. Nothing
     * writes these any more; see `models/Dispute.js`.
     */
    chargebackSettlementId: { ...settlementField },
    chargebackRecoveredAt: { type: Date },
    disputeAmount: { type: Number },
    disputeReason: { type: String },
    disputePhase: { type: String },
    disputedAt: { type: Date },
    // The date by which evidence must be submitted to Razorpay.
    disputeRespondBy: { type: Date },
    /**
     * How many deadline warnings have gone out for this dispute.
     *
     * The claim is this counter, updated in the same conditional write that
     * decides who sends — so two instances sweeping at once cannot both alert,
     * and a re-run of the job cannot repeat a stage. Monotonic: it only ever
     * goes up, and a dispute that resolves simply stops matching.
     */
    disputeAlertsSent: { type: Number, default: 0 },
    disputeResolvedAt: { type: Date },
    isRefunded: { type: Boolean, default: false },
    isRefundRequested: { type: Boolean, default: false },
    isPaidToVendor: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isRemoved: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

// Lets createSubscribeOrder find a still-open order for the same brand+plan
// instead of opening a duplicate one.
transactionSchema.index({
  brandId: 1,
  subscriptionId: 1,
  status: 1,
  createdAt: -1,
});

transactionSchema.index({ brandId: 1, isDeleted: 1, createdAt: -1 });

// The disputes worklist: open chargebacks, soonest deadline first.
transactionSchema.index({ isDisputed: 1, disputeStatus: 1, disputeRespondBy: 1 });

// ---------------------------------------------------------------------------
// Partial-unique indexes
//
// These replace the plain `unique: true` paths that used to sit on
// `razorpayOrderId` and `invoiceId`. Both are declared here, with EXPLICIT
// NAMES, for two reasons:
//
//  1. A voucher-claim row is inserted before it has an invoice number. In a
//     unique index that is neither sparse nor partial, a missing field indexes
//     as `null` — so exactly one such document could exist and the second
//     claim on the platform would fail with E11000.
//  2. Mongo derives `invoiceId_1` / `razorpayOrderId_1` for a path-level
//     unique. Reusing those names would make the migration impossible: it has
//     to create the new index, verify it, and only then drop the old one by
//     name. Editing the path in place instead raises IndexOptionsConflict (85),
//     which Mongoose swallows on the `index` event — leaving whichever index
//     happened to win and no error anywhere.
//
// `$type: "string"` is used rather than `sparse: true` because a sparse unique
// index still indexes an explicit `null`; this one skips both a missing field
// and an explicit null.
// ---------------------------------------------------------------------------

transactionSchema.index(
  { invoiceId: 1 },
  {
    unique: true,
    partialFilterExpression: { invoiceId: { $type: "string" } },
    name: TRANSACTION_INDEXES.INVOICE_ID,
  },
);

transactionSchema.index(
  { razorpayOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: { razorpayOrderId: { $type: "string" } },
    name: TRANSACTION_INDEXES.RAZORPAY_ORDER_ID,
  },
);

transactionSchema.index(
  { documentToken: 1 },
  {
    unique: true,
    partialFilterExpression: { documentToken: { $type: "string" } },
    name: TRANSACTION_INDEXES.DOCUMENT_TOKEN,
  },
);

// One open order per (customer, idempotency key). Scoped to the customer so two
// clients cannot collide on a weak key.
transactionSchema.index(
  { customerId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
    name: TRANSACTION_INDEXES.IDEMPOTENCY_KEY,
  },
);

// One transaction per claim, both ways.
transactionSchema.index(
  { "voucher.claimId": 1 },
  {
    unique: true,
    // $type rather than $exists: an explicitly-null claimId would satisfy
    // $exists and collide with the next one, which is the same trap the
    // invoiceId index exists to avoid.
    partialFilterExpression: { "voucher.claimId": { $type: "objectId" } },
    name: TRANSACTION_INDEXES.VOUCHER_CLAIM_ID,
  },
);

// ---------------------------------------------------------------------------
// Purpose-scoped read indexes
//
// Every one of these is partial on `purpose: VOUCHER_CLAIM`. That is the whole
// point: voucher claims will outnumber subscriptions by orders of magnitude, so
// a subscription insert must not pay to maintain a voucher index, and a vendor
// listing must not scan customer rows. Partial indexes give both for free.
// ---------------------------------------------------------------------------

const voucherOnly = {
  purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
};

transactionSchema.index(
  { purpose: 1, customerId: 1, createdAt: -1 },
  { partialFilterExpression: voucherOnly },
);

transactionSchema.index(
  { purpose: 1, brandId: 1, createdAt: -1 },
  { partialFilterExpression: voucherOnly },
);

transactionSchema.index(
  { purpose: 1, subBrandId: 1, createdAt: -1 },
  { partialFilterExpression: voucherOnly },
);

// Admin filters and the sweep jobs — both purposes.
transactionSchema.index({ purpose: 1, status: 1, createdAt: -1 });

// The webhook's lookup. Razorpay order ids are globally unique, so scoping by
// account is belt-and-braces — but it is what makes it structurally impossible
// for one account's payment to settle against the other account's order.
transactionSchema.index({ razorpayOrderId: 1, gatewayAccount: 1 });

/**
 * Finding a settlement's own rows — the detail screen and `releaseSettlementClaims`.
 *
 * ⚠️ Sparse, so it indexes only rows that **have** a settlement. That is right
 * for looking one up and useless for the eligibility scan below, which asks the
 * opposite question.
 */
transactionSchema.index({ settlementId: 1 }, { sparse: true });

/**
 * `buildSettlements`' eligibility scan, which runs **hourly, per brand**.
 *
 * ⚠️ The sparse index above cannot serve it, and that is not a tuning nicety —
 * it is structural. Eligibility asks for `settlementId: null`, and a sparse
 * index omits exactly those documents. So the query it was labelled as serving
 * could never use it, and the planner fell back to scanning every voucher
 * payment ever captured — once for `brandsWithEligibleMoney`'s `distinct`, then
 * again for each brand's claim.
 *
 * Not sparse, deliberately: a plain index stores nulls, which is the whole point.
 *
 * Key order follows the predicate's shape — the two equalities that eliminate
 * the most rows first, then the brand, then the range:
 *
 * ```
 * settlementHold: false        equality, and false for almost everything
 * settlementId:   null         equality, and the sparse index's blind spot
 * brandId:        <brand>      equality per brand; the leading prefix also lets
 *                              `distinct("brandId")` walk the index instead of
 *                              the collection
 * fundsReceivedAt: { $lte }    range, so it goes last
 * ```
 *
 * `isRefunded` and `verifiedAt` are left out on purpose: `$ne` cannot use an
 * index for selection, and adding a second range key after the first buys
 * nothing. Both are cheap filters once the scan is already narrow.
 */
transactionSchema.index(
  { settlementHold: 1, settlementId: 1, brandId: 1, fundsReceivedAt: 1 },
  {
    name: "settlement_eligibility",
    // Equality only — `partialFilterExpression` rejects `$in`, and this is the
    // one clause that keeps subscription payments out of a voucher-money index.
    partialFilterExpression: { purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM },
  },
);

module.exports = mongoose.model("Transaction", transactionSchema);
