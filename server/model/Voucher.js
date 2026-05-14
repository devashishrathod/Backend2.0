const mongoose = require("mongoose");
const { VOUCHER_TYPES, VOUCHER_STATUS } = require("../constants");
const {
  userField,
  brandField,
  subBrandsField,
  categoryField,
  subCategoryField,
  imagesField,
} = require("./validMogooseObjectId");

const claimedUserSchema = new mongoose.Schema(
  { userId: userField, claimedAt: { type: Date, default: Date.now } },
  { _id: false },
);

const voucherSchema = new mongoose.Schema(
  {
    user: userField,
    brand: brandField,
    subBrands: subBrandsField,
    createdBy: userField,
    category: categoryField,
    subCategory: subCategoryField,
    images: imagesField,
    claimedUsers: { type: [claimedUserSchema], default: [] },
    title: { type: String },
    description: { type: String, trim: true },
    type: {
      type: String,
      enum: [...Object.values(VOUCHER_TYPES)],
      default: VOUCHER_TYPES.PERCENTAGE,
    },
    status: {
      type: String,
      enum: [...Object.values(VOUCHER_STATUS)],
      required: true,
    },
    value: { type: Number },
    maxDiscountAmount: { type: Number },
    discount: { type: Number }, // offer percentage
    minOrderAmount: { type: Number }, // value of amount
    usageLimit: { type: Number, default: 1 },
    usedCount: { type: Number, default: 0 },
    validFrom: { type: Date, required: true },
    validTill: { type: Date, required: true },
    publishedDate: { type: Date, required: true },
    time: { type: String },
    uniqueId: { type: String, required: true },
    isPublished: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model("Voucher", voucherSchema);
