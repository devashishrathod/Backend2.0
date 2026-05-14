const mongoose = require("mongoose");
const {
  userField,
  voucherField,
  transactionField,
  subBrandField,
} = require("./validMogooseObjectId");

const BillSchema = new mongoose.Schema(
  {
    userId: userField,
    voucherId: voucherField,
    brandId: subBrandField,
    subBrandId: subBrandField,
    transactionId: transactionField,
    voucherDiscountValue: { type: Number, required: true },
    billAmount: { type: Number, required: true },
    appliedOffers: {
      type: [
        {
          offerType: {
            type: String,
            enum: ["PromoCode", "LessAmount"],
            default: null,
          },
          offerId: { type: mongoose.Schema.Types.ObjectId, default: null },
          discountValue: { type: Number, default: 0 },
        },
      ],
      default: [],
    },
    convenienceFee: { type: Number, default: 0 },
    totalDiscountValue: { type: Number, default: 0 },
    finalPayable: { type: Number, required: true },
    isVerified: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

function calculateConvenienceFee(amount) {
  return Math.ceil(amount / 500) * 5;
}

BillSchema.pre("save", async function () {
  if (!this.voucherId || this.voucherDiscountValue == null) {
    throw new Error("Voucher is mandatory for every bill.");
  }
  const seenTypes = new Set();
  for (const offer of this.appliedOffers || []) {
    if (seenTypes.has(offer.offerType)) {
      throw new Error(
        `Only one offer of type '${offer.offerType}' can be applied.`
      );
    }
    seenTypes.add(offer.offerType);
  }
  this.convenienceFee = calculateConvenienceFee(this.billAmount);
  this.totalDiscountValue =
    (this.voucherDiscountValue || 0) +
    (this.appliedOffers || []).reduce(
      (sum, o) => sum + (o.discountValue || 0),
      0
    );
  this.finalPayable = Math.max(
    0,
    this.billAmount - this.totalDiscountValue + this.convenienceFee
  );
});

module.exports = mongoose.model("Bill", BillSchema);
