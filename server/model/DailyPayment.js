const mongoose = require("mongoose");
const { DAILY_PAYMENT_TYPES, DAILY_PAYMENT_METHODS } = require("../constants");
const { isValidPhoneNumber } = require("../validator/common");
const {
  locationField,
  bankAccountField,
  refundField,
  brandField,
  userField,
} = require("./validMogooseObjectId");

const dailyPaymentSchema = new mongoose.Schema(
  {
    paymentBy: { type: String, default: "Trydood" },
    amount: { type: Number, required: true, min: 0 },
    transactions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Transaction",
        required: true,
      },
    ],
    location: locationField,
    creditBankAccount: bankAccountField,
    debitBankAccount: bankAccountField,
    refund: refundField,
    brand: brandField,
    user: userField,
    paymentMethod: {
      type: String,
      enum: [...Object.values(DAILY_PAYMENT_METHODS)],
      default: DAILY_PAYMENT_METHODS.CASH_DEPOSIT,
    },
    paymentTo: {
      type: String,
      enum: [...Object.values(DAILY_PAYMENT_TYPES)],
      required: true,
    },
    paymentDate: { type: Date, required: true },
    paymentTime: { type: String, required: true },
    status: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED"],
      default: "COMPLETED",
    },
    bankTransactionId: { type: String },
    paymentByMobile: {
      type: Number,
      validate: {
        validator: isValidPhoneNumber,
        message: (props) => `${props.value} is not a valid WhatsApp number`,
      },
    },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("DailyPayment", dailyPaymentSchema);
