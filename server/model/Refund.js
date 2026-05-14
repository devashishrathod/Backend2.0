const mongoose = require("mongoose");
const { REFUND_STATUS } = require("../constants");
const {
  userField,
  brandField,
  subBrandField,
  voucherField,
  transactionField,
  bankAccountField,
} = require("./validMogooseObjectId");

const refundSchema = new mongoose.Schema(
  {
    user: userField,
    brand: brandField,
    subBrand: subBrandField,
    voucher: voucherField,
    transaction: transactionField,
    bankAccount: bankAccountField,
    actionBy: userField,
    actionAt: { type: Date },
    refundAmount: { type: Number, required: true },
    reason: { type: String, trim: true },
    status: {
      type: String,
      enum: [...Object.values(REFUND_STATUS)],
      default: REFUND_STATUS.SUBMITTED,
    },
    uniqueId: { type: String, required: true, unique: true },
    isApproved: { type: Boolean, default: false },
    isPaid: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("Refund", refundSchema);
