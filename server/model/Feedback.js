const mongoose = require("mongoose");
const {
  userField,
  brandField,
  subBrandField,
  imagesField,
  voucherField,
} = require("./validMogooseObjectId");

const feedbackSchema = new mongoose.Schema(
  {
    user: userField,
    brand: brandField,
    voucher: voucherField,
    subBrand: subBrandField,
    imageIds: imagesField,
    rating: { type: Number, min: 1, max: 5, required: true },
    review: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("Feedback", feedbackSchema);
