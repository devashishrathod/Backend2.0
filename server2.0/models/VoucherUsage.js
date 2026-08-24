const mongoose = require("mongoose");
const {
  voucherField,
  subBrandField,
  customerField,
} = require("./validObjectId");

const voucherUsageSchema = new mongoose.Schema(
  {
    voucherId: {
      ...voucherField,
      required: true,
    },
    offerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VoucherOffer",
      required: true,
    },
    customerId: {
      ...customerField,
      required: true,
    },

    subBrandId: {
      ...subBrandField,
      required: true,
    },

    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },

    /*
     * Snapshot of applied billing.
     */
    billAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    discountAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    voucherRevision: {
      type: Number,
      required: true,
    },

    offerSnapshot: {
      minBillAmount: {
        type: Number,
        required: true,
      },

      discountType: {
        type: String,
        required: true,
      },

      discountValue: {
        type: Number,
        required: true,
      },

      maxDiscountAmount: {
        type: Number,
        default: null,
      },
    },

    usedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

/*
 * Critical for ONCE_PER_USER.
 *
 * Prevents two simultaneous requests from using
 * same voucher twice.
 */
voucherUsageSchema.index(
  {
    voucherId: 1,
    customerId: 1,
  },
  {
    unique: true,
  },
);

voucherUsageSchema.index({
  customerId: 1,
  usedAt: -1,
});

voucherUsageSchema.index({
  voucherId: 1,
  usedAt: -1,
});

voucherUsageSchema.index({
  orderId: 1,
});

module.exports = mongoose.model("VoucherUsage", voucherUsageSchema);
