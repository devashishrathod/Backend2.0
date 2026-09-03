const mongoose = require("mongoose");
const { voucherField } = require("./validObjectId");
const { VOUCHER_APPROVAL_ACTION } = require("../constants/voucher");
const {
  isValidateVoucherCode,
  isValidateVoucherVersionCode,
} = require("../validator/common");

const voucherApprovalHistorySchema = new mongoose.Schema(
  {
    voucherId: {
      ...voucherField,
      required: true,
    },
    voucherVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VoucherVersion",
      required: true,
    },
    brandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
    },
    action: {
      type: String,
      enum: Object.values(VOUCHER_APPROVAL_ACTION),
      required: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    versionNumber: {
      type: Number,
      required: true,
    },
    voucherCode: {
      type: String,
      required: true,
      index: true,
      validate: {
        validator: isValidateVoucherCode,
        message: (props) => `${props.value} is not a valid Voucher Code`,
      },
    },
    versionCode: {
      type: String,
      required: true,
      index: true,
      validate: {
        validator: isValidateVoucherVersionCode,
        message: (props) => `${props.value} is not a valid Version Code`,
      },
    },
    reason: {
      type: String,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

voucherApprovalHistorySchema.index({
  voucherId: 1,
  createdAt: -1,
});

voucherApprovalHistorySchema.index({
  performedBy: 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  "VoucherApprovalHistory",
  voucherApprovalHistorySchema,
);
