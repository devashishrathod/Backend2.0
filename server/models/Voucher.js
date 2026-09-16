const mongoose = require("mongoose");
const { mediaSchema } = require("./mediaSchema");
const { userField, brandField } = require("./validObjectId");
const { VOUCHER_STATUSES } = require("../constants/voucher");
const {
  VOUCHER_BANNER_TYPE,
  VOUCHER_BANNER_MEDIA_FIELD,
} = require("../constants/voucherBanner");
const { isValidateVoucherCode } = require("../validator/common");

/**
 * 🔴 `voucherBannerMediaSchema` used to be defined here.
 *
 * It was `url` plus an inline `storage` object with the provider enum written
 * out by hand — one of five such copies (P11). Every one of them now reads
 * `mediaSchema`, so a banner also carries what the file **is** (`kind`), how big
 * it is, and, on a video, its poster.
 *
 * ⚠️ The `type` + three-field shape below is **still here on purpose**. V-4
 * collapses it into a single `{ current, pending, status }` slot as part of the
 * banner approval flow; doing the collapse here would leave every banner sitting
 * in `pending` with no endpoint able to approve it, and customers seeing the
 * `images[0]` fallback in the meantime. The media unification is this phase; the
 * workflow is that one.
 */

/**
 * "A banner that names this type must carry this file."
 *
 * ### 🔴 Why this is a `required` function and not a `pre("validate")` hook
 *
 * It **was** a hook, and the hook did `throw new Error(...)`. Throwing from
 * inside validation escapes as a plain Error with no status, so a request that
 * simply named the wrong type came back as a **500** rather than a 422 naming
 * the missing field.
 *
 * ⚠️ Rewriting it as `this.invalidate()` fixed the status but not the reach:
 * Mongoose runs `pre("validate")` middleware **only on the async path**, so
 * `validateSync()` reported a perfectly clean document — measured. A `required`
 * function runs on both, which matters because this is the only thing standing
 * between a `type` and the file it claims to have.
 *
 * This is the third time this family of trap has cost something in this
 * migration: `this.invalidate()` inside a *nested sub-document* hook does
 * nothing at all (F-3's poster, M-2's locatable check), and `validateSync()`
 * skipping hooks hid the showcase clips rule too. Conditional `required` has
 * neither problem.
 *
 * `this` is the root document here — `banner` is a plain object path, not a
 * sub-document — so `this.banner.type` is the question being asked.
 */
const requiredForType = (type) => ({
  required: [
    function () {
      return this.banner?.type === type;
    },
    `A ${type} banner needs a ${VOUCHER_BANNER_MEDIA_FIELD[type]} file.`,
  ],
});

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

    // ---------------------------------------------------------------------
    // Admin curation — the "Suggestions" tab on the customer app.
    //
    // A flag on the voucher rather than a join table, so the customer listing
    // sorts on it directly instead of paying for another lookup on every page.
    //
    // Nothing here forces a voucher to be visible: the customer pipeline still
    // only surfaces PUBLISHED versions inside their validity window, so a
    // suggested voucher that expires or gets unpublished drops out of the feed
    // on its own and no admin has to go tidy the list.
    // ---------------------------------------------------------------------
    isSuggested: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Lower sorts first among suggested vouchers.
    suggestionOrder: {
      type: Number,
      default: 0,
    },
    suggestedAt: {
      type: Date,
      default: null,
    },
    suggestedBy: userField,

    // Independent of the version/approval flow entirely — a single "current
    // banner" slot on the master voucher for brand offer promotion. Adding,
    // replacing, or removing it never touches status/approval/versions.
    banner: {
      type: {
        type: String,
        enum: Object.values(VOUCHER_BANNER_TYPE),
        default: null,
      },
      /**
       * ⚠️ `default: undefined`, not `default: () => ({})`.
       *
       * 🔴 The old default stamped **three empty objects onto every voucher**
       * (P9) — a banner-less voucher still carried `image: {}`, `video: {}` and
       * `gif: {}`. With `mediaSchema` that is worse than untidy: `{}` has no
       * `kind` and no locator, so it is an invalid media that would fail
       * validation on a document nobody ever gave a banner to. Absent means
       * absent.
       */
      image: { type: mediaSchema, default: undefined, ...requiredForType("IMAGE") },
      video: { type: mediaSchema, default: undefined, ...requiredForType("VIDEO") },
      gif: { type: mediaSchema, default: undefined, ...requiredForType("GIF") },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// The banner's "type names a file that must exist" rule lives on the fields
// themselves — see `requiredForType` above for why it is not a hook.

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
