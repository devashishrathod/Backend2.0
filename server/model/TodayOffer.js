const mongoose = require("mongoose");
const {
  dealOfCategoryField,
  vouchersField,
} = require("./validMogooseObjectId");

const todayOfferSchema = new mongoose.Schema(
  {
    dealOfCategory: dealOfCategoryField,
    vouchers: vouchersField,
    title: { type: String },
    description: { type: String, trim: true },
    validFrom: { type: Date, required: true },
    validTill: { type: Date, required: true },
    uniqueId: { type: String, unique: true, required: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("TodayOffer", todayOfferSchema);
