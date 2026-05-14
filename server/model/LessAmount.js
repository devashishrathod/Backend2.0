const mongoose = require("mongoose");
const { userField, voucherField } = require("./validMogooseObjectId");
const { OFFERS_SCOPE } = require("../constants");

const claimedUserSchema = new mongoose.Schema(
  { userId: userField, claimedAt: { type: Date, default: Date.now } },
  { _id: false }
);

const lessAmountSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      enum: [...Object.values(OFFERS_SCOPE)],
      default: OFFERS_SCOPE.ALL_USERS,
    },
    users: { type: [userField], default: [] },
    voucher: voucherField,
    claimedUsers: { type: [claimedUserSchema], default: [] },
    title: { type: String },
    description: { type: String, trim: true },
    maxDiscountValue: { type: Number, required: true },
    validFrom: { type: Date, required: true },
    validTill: { type: Date, required: true },
    uniqueId: { type: String, unique: true, required: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("LessAmount", lessAmountSchema);
