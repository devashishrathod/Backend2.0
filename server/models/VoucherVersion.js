const mongoose = require("mongoose");
const { mediaSchema } = require("./mediaSchema");
const { isValidateVoucherVersionCode } = require("../validator/common");
const { userField, brandField } = require("./validObjectId");
const {
  VOUCHER_STATUSES,
  VOUCHER_DISCOUNT_TYPES,
  VOUCHER_OFFER_LIMITS,
  VOUCHER_USAGE_TYPE,
  DISCOUNT_APPLICABLE_ON,
} = require("../constants/voucher");
// 🔴 `const { required } = require("joi")` used to sit here (P10). Nothing in
// this file ever used it — a model has no business importing a request
// validator, and the name it pulled in shadows nothing, so it was dead weight
// that made the dependency graph read as though Mongoose and Joi were coupled.

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

/**
 * One picture in a voucher's gallery.
 *
 * ### 🔴 What this replaces
 *
 * `url` + an inline `storage` object that wrote the provider enum out by hand —
 * one of **five** such copies across the models, which is why `STORAGE_PROVIDER`
 * looked like a single source without being one (P11). Renaming `S3` to `AWS_S3`
 * would have left these documents validating against a value nothing else used.
 *
 * The file now sits in `media`, exactly the `mediaSchema` every other surface
 * uses, and the gallery's own field — `sortOrder` — sits beside it.
 */
const voucherImageSchema = new mongoose.Schema(
  {
    media: { type: mediaSchema, required: [true, "An image file is required."] },
    /**
     * ⚠️ No `max` any more (P4).
     *
     * It was `max: 5`, hard-coded, while the actual ceiling lives in
     * `VOUCHER_OFFER_LIMITS.MAX_IMAGES` and is heading for the Setting (V-1).
     * The two could disagree the moment either moved, and the model's copy would
     * win — refusing a sixth image with a schema error that named no limit the
     * vendor had ever been shown. The array validators below hold the count; a
     * position just has to be a position.
     */
    sortOrder: {
      type: Number,
      required: true,
      min: 1,
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
    /**
     * When the vendor took this version out of the feed, and why (V-5).
     *
     * ⚠️ Cleared on resume, unlike `archivedAt` and `expiredAt`. Those two
     * record something that happened and stays happened; a pause is a state the
     * version is *in*, and it ends. Leaving the stamp behind would tell a report
     * a live voucher is paused, and leave the reason sitting beside a voucher
     * that is back up.
     *
     * The reason is the vendor's own note — "out of stock until Monday" — not a
     * moderation verdict. `rejectionReason` is the other kind and is deliberately
     * a different field: one is something they chose, the other something that
     * was done to them, and collapsing the two would show an admin's refusal in
     * the place a vendor expects to see their own words.
     */
    pausedAt: {
      type: Date,
      default: null,
    },
    pausedBy: {
      ...userField,
    },
    pauseReason: {
      type: String,
      trim: true,
      default: null,
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

// Power the `stats.vouchers` counts on the category and sub-category listings.
// The taxonomy lives here rather than on the master Voucher, so those counts
// enter this collection first and would otherwise scan every version ever made.
voucherVersionSchema.index({ categoryId: 1, isDeleted: 1 });
voucherVersionSchema.index({ subCategoryId: 1, isDeleted: 1 });

// Powers sortBy=RELEVANCE (textScore) on the admin voucher versions listing.
voucherVersionSchema.index(
  { name: "text", description: "text", versionCode: "text", tags: "text" },
  {
    name: "VoucherVersionTextIndex",
    weights: { name: 5, versionCode: 4, tags: 3, description: 1 },
  },
);

module.exports = mongoose.model("VoucherVersion", voucherVersionSchema);
