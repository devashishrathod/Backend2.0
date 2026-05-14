const mongoose = require("mongoose");
const validator = require("validator");
const { isValidPhoneNumber } = require("../validator/common");
const {
  userField,
  subscriptionField,
  brandField,
  subBrandField,
  voucherField,
  billField,
} = require("./validMogooseObjectId");
const {
  PAYMENT_STATUS,
  PAYMENT_METHODS,
  WALLET_PROVIDERS,
} = require("../constants");

const transactionSchema = new mongoose.Schema(
  {
    user: userField,
    brand: brandField,
    subBrand: subBrandField,
    subscription: subscriptionField,
    voucher: voucherField,
    bill: billField,
    createdBy: userField,
    entity: { type: String },
    amount: { type: Number, required: true },
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
        validator: validator.isEmail,
        message: (props) => `${props.value} is not a valid email address`,
      },
    },
    contact: {
      type: Number,
      validate: {
        validator: isValidPhoneNumber,
        message: (props) => `${props.value} is not a valid mobile number`,
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
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },
    invoiceId: { type: String },
    invoiceUrl: { type: String },
    receipt: { type: String, maxlength: 40 },
    amountRefunded: { type: Number, default: 0 },
    verified: { type: Boolean, default: false },
    notes: { type: Array, default: [] },
    fee: { type: Number },
    tax: { type: Number },
    isInternational: { type: Boolean, default: false },
    refundStatus: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED", null],
      default: null,
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
    paidToVendorAt: Date,
    paidRefundAt: Date,
    dailyPayment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DailyPayment",
    },
    refund: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Refund",
    },
    isRefunded: { type: Boolean, default: false },
    isRefundRequested: { type: Boolean, default: false },
    isPaidToVendor: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isRemoved: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("Transaction", transactionSchema);
