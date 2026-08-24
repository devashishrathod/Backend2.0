const mongoose = require("mongoose");
const { userField, brandField } = require("./validObjectId");
const { VOUCHER_STATUSES } = require("../constants/voucher");
const {
  VOUCHER_BANNER_TYPE,
  VOUCHER_BANNER_MEDIA_FIELD,
} = require("../constants/voucherBanner");
const { isValidateVoucherCode } = require("../validator/common");

const voucherBannerMediaSchema = new mongoose.Schema(
  {
    url: { type: String, trim: true },
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
  },
  { _id: false },
);

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
    // Independent of the version/approval flow entirely — a single "current
    // banner" slot on the master voucher for brand offer promotion. Adding,
    // replacing, or removing it never touches status/approval/versions.
    banner: {
      type: {
        type: String,
        enum: Object.values(VOUCHER_BANNER_TYPE),
        default: null,
      },
      image: { type: voucherBannerMediaSchema, default: () => ({}) },
      video: { type: voucherBannerMediaSchema, default: () => ({}) },
      gif: { type: voucherBannerMediaSchema, default: () => ({}) },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

voucherSchema.pre("validate", function () {
  if (!this.banner || !this.banner.type) return;
  const field = VOUCHER_BANNER_MEDIA_FIELD[this.banner.type];
  const media = this.banner[field];
  if (!media || !media.url) {
    throw new Error(
      `${field} media is required for voucher banner type '${this.banner.type}'.`,
    );
  }
});

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

// Powers sortBy=RELEVANCE (textScore) on the customer voucher listing search.
voucherSchema.index(
  { name: "text", description: "text" },
  { name: "VoucherTextIndex", weights: { name: 5, description: 1 } },
);

module.exports = mongoose.model("Voucher", voucherSchema);
