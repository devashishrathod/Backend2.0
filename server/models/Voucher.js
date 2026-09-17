const mongoose = require("mongoose");
const { mediaSchema } = require("./mediaSchema");
const { userField, brandField } = require("./validObjectId");
const { VOUCHER_STATUSES } = require("../constants/voucher");
const { VOUCHER_BANNER_STATUS } = require("../constants/voucherBanner");
const { isValidateVoucherCode } = require("../validator/common");

/**
 * 🔴 Two things used to live here, and both are gone.
 *
 * `voucherBannerMediaSchema` was `url` plus an inline `storage` object with the
 * provider enum written out by hand — one of five such copies (P11). Every one
 * of them reads `mediaSchema` now, so a banner also carries what the file
 * **is** (`kind`), how big it is, and, on a video, its poster.
 *
 * `requiredForType` enforced "a banner that names this type must carry this
 * file" across `banner.image` / `.video` / `.gif`. V-4 removed the type and the
 * three slots together — see the `banner` field below — so there is no longer a
 * label that could disagree with a file. The question it answered does not
 * exist any more.
 *
 * ⚠️ Why it was shaped the way it was is worth keeping, because the trap is
 * still live elsewhere: it was a conditional `required` rather than a
 * `pre("validate")` hook, because Mongoose runs those hooks **only on the async
 * path** — so `validateSync()` reported a document with a missing file as
 * perfectly clean. That family of trap has cost this migration four separate
 * findings.
 */
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

    /**
     * The voucher's master banner — one slot, reviewed on its own (V-4).
     *
     * ### 🔴 What this replaces, and why the old shape could not stay
     *
     * It was `{ type, image, video, gif }`: a stored label beside three slots,
     * one of which was meant to be filled. That is a second source of truth —
     * `type` could disagree with the file beside it and nothing reconciled them,
     * which is the exact bug the home banner carried for months. `media.kind`
     * answers the same question from the bytes, so the label is gone.
     *
     * It also stamped **three empty objects onto every voucher** (P9), because
     * all three defaulted to `{}`. With `mediaSchema` that is not merely untidy:
     * `{}` has no `kind` and no locator, so every banner-less voucher carried
     * three invalid media values.
     *
     * ### Two slots, because a replacement must not take the live one down
     *
     * `current` is what customers see and is always APPROVED. `pending` is what
     * an admin has yet to look at. A vendor replacing their banner keeps serving
     * the old one until the new one is approved (V-5) — the alternative is a
     * blank tile on a live offer for however long the review queue takes.
     *
     * ### ⚠️ An empty banner slot is a normal state, not a broken one
     *
     * A rejected banner, or one still pending, leaves `current` absent. The
     * customer read falls back to the voucher's first image (V-4a), so the
     * voucher stays published and the slot is never empty on screen. Nothing
     * here should ever be read as "this voucher has no banner, hide it".
     */
    banner: {
      /** Live, approved, customer-visible. Absent until an admin approves one. */
      current: { type: mediaSchema, default: undefined },
      /** Uploaded and waiting. Never customer-visible. */
      pending: { type: mediaSchema, default: undefined },
      /**
       * Where the **pending** one stands. `null` when there is nothing in
       * review — which is the ordinary state of a voucher whose banner is live.
       */
      status: {
        type: String,
        enum: Object.values(VOUCHER_BANNER_STATUS),
        default: null,
      },
      /**
       * Why an admin refused it. The vendor sees this, so it is the whole point
       * of a rejection — "REJECTED" on its own tells them nothing to act on.
       */
      rejectionReason: { type: String, trim: true, default: null },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
      reviewedAt: { type: Date, default: null },
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

// Powers sortBy=RELEVANCE (textScore) on the customer voucher listing search.
voucherSchema.index(
  { name: "text", description: "text" },
  { name: "VoucherTextIndex", weights: { name: 5, description: 1 } },
);

module.exports = mongoose.model("Voucher", voucherSchema);
