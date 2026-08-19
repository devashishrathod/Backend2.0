const mongoose = require("mongoose");
const { userField, brandField } = require("./validObjectId");
const { VOUCHER_STATUSES } = require("../constants/voucher");
const { isValidateVoucherCode } = require("../validator/common");

const voucherSchema = new mongoose.Schema(
  {
    createdBy: {
      ...userField,
      required: true,
    },
    updatedBy: {
      ...userField,
    },
    brandId: {
      ...brandField,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
    },
    timezone: {
      type: String,
      default: "Asia/Kolkata",
      trim: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    // usageType: {
    //   type: String,
    //   enum: Object.values(VOUCHER_USAGE_TYPE),
    //   default: VOUCHER_USAGE_TYPE.MULTIPLE,
    // },
    // discountApplicableOn: {
    //   type: String,
    //   enum: Object.values(DISCOUNT_APPLICABLE_ON),
    //   default: DISCOUNT_APPLICABLE_ON.SUBTOTAL,
    // },
    // images: {
    //   type: [voucherImageSchema],
    //   default: [],
    //   validate: {
    //     validator: function (images) {
    //       return images.length <= 5;
    //     },
    //     message: "Maximum 5 images are allowed.",
    //   },
    // },
    currentVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VoucherVersion",
    },
    publishedVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VoucherVersion",
    },
    currentVersion: {
      type: Number,
      default: 1,
    },
    publishedVersion: {
      type: Number,
    },
    status: {
      type: String,
      enum: Object.values(VOUCHER_STATUSES),
      default: VOUCHER_STATUSES.DRAFT,
    },
    voucherCode: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      index: true,
      validate: {
        validator: isValidateVoucherCode,
        message: (props) => `${props.value} is not a valid Voucher Code`,
      },
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

voucherSchema.index(
  {
    brandId: 1,
    normalizedName: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      isDeleted: false,
    },
  },
);

voucherSchema.index({
  brandId: 1,
  status: 1,
  isDeleted: 1,
  createdAt: -1,
});

voucherSchema.index({
  brandId: 1,
  isActive: 1,
  isDeleted: 1,
});

module.exports = mongoose.model("Voucher", voucherSchema);
