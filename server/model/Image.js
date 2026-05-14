const mongoose = require("mongoose");
const { PLATFORMS } = require("../constants");
const {
  userField,
  brandField,
  subBrandField,
  categoryField,
  subCategoryField,
  feedbackField,
  voucherField,
} = require("./validMogooseObjectId");

const imageSchema = new mongoose.Schema(
  {
    user: userField,
    brand: brandField,
    subBrand: subBrandField,
    category: categoryField,
    subCategory: subCategoryField,
    feedback: feedbackField,
    voucher: voucherField,
    imageUrl: { type: String, required: true },
    filename: { type: String, required: true },
    size: { type: Number, required: true },
    mime: { type: String, required: true },
    type: { type: String, enum: [...Object.values(PLATFORMS)] },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model("Image", imageSchema);
