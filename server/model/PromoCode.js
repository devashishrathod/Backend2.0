const mongoose = require("mongoose");
const { voucherField, userField } = require("./validMogooseObjectId");

const claimedUserSchema = new mongoose.Schema(
  { userId: userField, claimedAt: { type: Date, default: Date.now } },
  { _id: false }
);

const promoCodeSchema = new mongoose.Schema(
  {
    claimedUsers: { type: [claimedUserSchema], default: [] },
    voucher: voucherField,
    title: { type: String },
    description: { type: String, trim: true },
    promoCode: { type: String, required: true, trim: true },
    maxDiscountValue: { type: Number, required: true },
    userLimit: { type: Number, required: true },
    validFrom: { type: Date, required: true },
    validTill: { type: Date, required: true },
    uniqueId: { type: String, unique: true, required: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("PromoCode", promoCodeSchema);
