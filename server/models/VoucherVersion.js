const mongoose = require("mongoose");
const { isValidateVoucherVersionCode } = require("../validator/common");
const { userField, brandField } = require("./validObjectId");
const {
  VOUCHER_STATUSES,
  VOUCHER_DISCOUNT_TYPES,
  VOUCHER_OFFER_LIMITS,
  VOUCHER_USAGE_TYPE,
  DISCOUNT_APPLICABLE_ON,
} = require("../constants/voucher");
const { required } = require("joi");

const voucherVersionOfferSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    minBillAmount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    discountType: {
      type: String,
      enum: Object.values(VOUCHER_DISCOUNT_TYPES),
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0.01,
    },
    maxDiscountAmount: {
      type: Number,
    },
    usageType: {
      type: String,
      enum: Object.values(VOUCHER_USAGE_TYPE),
      default: VOUCHER_USAGE_TYPE.MULTIPLE,
    },
    discountApplicableOn: {
      type: String,
      enum: Object.values(DISCOUNT_APPLICABLE_ON),
      default: DISCOUNT_APPLICABLE_ON.SUBTOTAL,
    },
    sortOrder: {
      type: Number,
      required: true,
      min: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { _id: true, versionKey: false },
);

const voucherImageSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
    },
    storage: {
      provider: {
        type: String,
        enum: ["CLOUDINARY", "S3"],
        default: "CLOUDINARY",
      },
      publicId: { type: String },
      bucket: { type: String },
      key: { type: String },
    },
    sortOrder: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
  },
  { _id: true, versionKey: false },
);

const voucherVersionSchema = new mongoose.Schema(
  {
    voucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Voucher",
      required: true,
      index: true,
    },
    brandId: {
      ...brandField,
      required: true,
    },
    versionNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    // Master voucher
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    subCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubCategory",
      required: true,
    },
    images: {
      type: [voucherImageSchema],
      default: [],
      validate: [
        {
          validator: function (images) {
            return images.length >= 1;
          },
          message: "At least one image is required.",
        },
        {
          validator: function (images) {
            return images.length <= VOUCHER_OFFER_LIMITS.MAX_IMAGES;
          },
          message: `Maximum ${VOUCHER_OFFER_LIMITS.MAX_IMAGES} images are allowed.`,
        },
      ],
    },
    offers: {
      type: [voucherVersionOfferSchema],
      default: [],
      validate: {
        validator: function (offers) {
          return offers.length >= 1;
        },
        message: "At least one offer is required.",
      },
    },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    status: {
      type: String,
      enum: Object.values(VOUCHER_STATUSES),
      default: VOUCHER_STATUSES.DRAFT,
      index: true,
    },
    attachedSubBrandsCount: { type: Number, default: 0 },
    versionCode: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      index: true,
      validate: {
        validator: isValidateVoucherVersionCode,
        message: (props) => `${props.value} is not a valid Version Code`,
      },
    },
    createdBy: {
      ...userField,
      required: true,
    },
    submittedBy: {
      ...userField,
    },
    submittedAt: {
      type: Date,
    },
    reviewedAt: {
      type: Date,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvedBy: {
      ...userField,
    },
    approvedAt: {
      type: Date,
    },
    publishedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
    },
    rejectedBy: {
      ...userField,
    },
    rejectedAt: {
      type: Date,
    },
    expiredAt: {
      type: Date,
    },
    archivedAt: {
      type: Date,
    },
    isImmutable: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

voucherVersionSchema.index(
  {
    voucherId: 1,
    versionNumber: 1,
  },
  {
    unique: true,
  },
);

voucherVersionSchema.index({
  voucherId: 1,
  status: 1,
  isActive: 1,
  isDeleted: 1,
});

voucherVersionSchema.index({
  status: 1,
  startAt: 1,
  endAt: 1,
});

voucherVersionSchema.index(
  {
    voucherId: 1,
    status: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      status: "PUBLISHED",
      isDeleted: false,
    },
  },
);

// Powers sortBy=RELEVANCE (textScore) on the admin voucher versions listing.
voucherVersionSchema.index(
  { name: "text", description: "text", versionCode: "text", tags: "text" },
  {
    name: "VoucherVersionTextIndex",
    weights: { name: 5, versionCode: 4, tags: 3, description: 1 },
  },
);

module.exports = mongoose.model("VoucherVersion", voucherVersionSchema);
