const mongoose = require("mongoose");
const { isValidEmail, isValidPhoneNumber } = require("../validator/common");
const {
  userField,
  subscriptionField,
  brandField,
  subBrandField,
  voucherField,
  billField,
  settlementField,
  refundField,
  subscribedField,
} = require("./validObjectId");
const { pricingSchema } = require("./pricingSchema");
const { invoiceSnapshotSchema } = require("./invoiceSnapshotSchema");
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

const transactionSchema = new mongoose.Schema(
  {
    userId: userField,
    brandId: brandField,
    subBrandId: subBrandField,
    subscriptionId: subscriptionField,
    subscribedId: subscribedField,
    voucherId: voucherField,
    billId: billField,
    createdBy: userField,
    settlementId: settlementField,
    refundId: refundField,
    entity: { type: String },
    amount: { type: Number, required: true },
    // Full tax/discount breakdown behind `amount`. Frozen at order time so the
    // invoice never drifts when a plan's price or the GST rate changes later.
    pricing: { type: pricingSchema, default: () => ({}) },
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
    // No longer required: admin grants (gateway MANUAL) never touch Razorpay.
    //
    // The unique index is intentionally left NON-sparse to match the index
    // already live in the database — switching it would raise
    // IndexOptionsConflict on every boot. Instead, MANUAL rows are written with
    // a synthetic `MANUAL-<invoiceId>` reference (see adminGrantSubscription),
    // so they satisfy the unique index without colliding on null.
    razorpayOrderId: { type: String, unique: true },
    razorpayPaymentId: { type: String, index: true, sparse: true },
    razorpaySignature: { type: String },
    invoiceId: { type: String, unique: true },
    invoiceUrl: { type: String },
    // Everything the invoice prints, frozen when it is issued. The generator
    // reads only this and performs no live lookups, so a re-issue reproduces the
    // original exactly — even after the plan is renamed or the seller's GSTIN
    // changes. See models/invoiceSnapshotSchema.js.
    invoiceSnapshot: { type: invoiceSnapshotSchema },
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
    disputeAmount: { type: Number },
    disputeReason: { type: String },
    disputePhase: { type: String },
    disputedAt: { type: Date },
    // The date by which evidence must be submitted to Razorpay.
    disputeRespondBy: { type: Date },
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

module.exports = mongoose.model("Transaction", transactionSchema);
