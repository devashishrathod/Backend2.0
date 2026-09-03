const mongoose = require("mongoose");
const {
  brandField,
  customerField,
  userField,
  settlementField,
  refundRequestField,
} = require("./validObjectId");
const {
  PAYOUT_TYPE,
  PAYOUT_LEG_STATUS,
  PAYOUT_MODE,
  PAYOUT_INDEXES,
} = require("../constants/payout");
const { PAYOUT_PROVIDERS } = require("../constants/customer");

/**
 * The payee as it stood **when this leg was initiated**.
 *
 * ⚠️ Not the settlement's snapshot, and not the live account. A settlement
 * freezes the account at build time, but a MANUAL_BANK payout can go out days
 * later and can be retried days after that — and `createBank.js` soft-deletes
 * the old record and repoints `brand.BankId` when a vendor changes their
 * details. A leg retried after such a change must record where **that attempt**
 * actually sent the money, or the UTR on file points at an account nobody paid.
 */
const legBankSnapshotSchema = new mongoose.Schema(
  {
    accountHolderName: { type: String, trim: true },
    maskedAccountNumber: { type: String, trim: true },
    accountLast4Digits: { type: String, trim: true },
    ifscCode: { type: String, trim: true, uppercase: true },
    bankName: { type: String, trim: true },
    bankId: { type: mongoose.Schema.Types.ObjectId },
  },
  { _id: false },
);

/**
 * One movement of money out of Trydood — to a vendor, or back to a customer.
 *
 * ### Why this is not a `payoutUtr` field on the settlement
 *
 * Money does not move in one leg:
 *
 *  - **MANUAL_BANK** — an admin can split a large payout across two NEFTs, and
 *    can retry after a bounce. Two UTRs, one field would lose one.
 *  - **RazorpayX** — every retry produces a new payout id.
 *  - **Route** — one transfer per payment, then Razorpay settles them to the
 *    linked account in its own batches: one settlement becomes N transfer ids
 *    and M recipient-settlement ids.
 *
 * ### And why refunds share the model
 *
 * A `MANUAL_BANK` refund is the same operation with a different payee: an admin
 * sends a NEFT and types in a UTR. One model means one adapter, one reconcile
 * job, one place a UTR lives — and when RazorpayX or Route arrives, both switch
 * together instead of one being quietly left behind.
 */
const payoutLegSchema = new mongoose.Schema(
  {
    payoutType: {
      type: String,
      enum: Object.values(PAYOUT_TYPE),
      required: true,
      index: true,
    },

    /**
     * Set on a settlement payout — and on a refund too, so *"which settlement
     * absorbed this refund's deduction"* is one query from either side.
     */
    settlementId: settlementField,
    refundRequestId: refundRequestField,
    brandId: brandField,
    customerId: customerField,

    /**
     * 1, 2, 3… within one parent.
     *
     * Unique per parent, which is what stops a double-click producing two legs
     * for the same tranche of money.
     */
    legNumber: { type: Number, required: true, default: 1 },
    amount: { type: Number, required: true },

    provider: {
      type: String,
      enum: Object.values(PAYOUT_PROVIDERS),
      default: PAYOUT_PROVIDERS.MANUAL_BANK,
    },
    /** Payout id, transfer id, or Razorpay refund id — whatever the provider gave. */
    providerReference: { type: String, trim: true },
    /**
     * The bank reference.
     *
     * The one field both a vendor and a customer will quote back at support when
     * money has not landed, so it is indexed and searchable rather than buried
     * in a provider blob.
     */
    utr: { type: String, trim: true },
    mode: { type: String, enum: Object.values(PAYOUT_MODE) },

    status: {
      type: String,
      enum: Object.values(PAYOUT_LEG_STATUS),
      default: PAYOUT_LEG_STATUS.INITIATED,
      required: true,
      index: true,
    },

    bankSnapshot: { type: legBankSnapshotSchema, default: undefined },

    initiatedAt: { type: Date, default: Date.now },
    paidAt: { type: Date },
    failedAt: { type: Date },
    failureReason: { type: String, trim: true, maxlength: 500 },
    /** Which admin actually pressed it. A payout is never anonymous. */
    initiatedBy: userField,

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

/**
 * ⚠️ One leg number per settlement.
 *
 * `$type: "objectId"` rather than `sparse: true` — a sparse index still indexes
 * an explicit `null`, so every **refund** leg (which has no `settlementId`)
 * would collide with the next on a rule that was never meant to apply to it.
 * That is the bug the legacy `invoiceId_1` index caused, and it actually fired
 * in 1B.
 */
payoutLegSchema.index(
  { payoutType: 1, settlementId: 1, legNumber: 1 },
  {
    name: PAYOUT_INDEXES.SETTLEMENT_LEG,
    unique: true,
    partialFilterExpression: { settlementId: { $type: "objectId" } },
  },
);

payoutLegSchema.index(
  { payoutType: 1, refundRequestId: 1, legNumber: 1 },
  {
    name: PAYOUT_INDEXES.REFUND_LEG,
    unique: true,
    partialFilterExpression: { refundRequestId: { $type: "objectId" } },
  },
);

/**
 * A UTR identifies one bank movement and must never appear twice.
 *
 * Not unique on purpose: a single NEFT can legitimately carry a batch in some
 * banking setups, and refusing the second row would block a correct entry. It is
 * indexed so support can find a payment by the reference a vendor read off their
 * statement.
 */
payoutLegSchema.index(
  { utr: 1 },
  { partialFilterExpression: { utr: { $type: "string" } } },
);

payoutLegSchema.index(
  { providerReference: 1 },
  { partialFilterExpression: { providerReference: { $type: "string" } } },
);

// `reconcilePayouts`: legs that left and never reported back.
payoutLegSchema.index({ status: 1, initiatedAt: 1 });

module.exports = mongoose.model("PayoutLeg", payoutLegSchema);
