const mongoose = require("mongoose");
const { mediaSchema } = require("./mediaSchema");
const { BANNER_MEDIA_KINDS, BANNER_REDIRECT_TYPE } = require("../constants/banner");

/**
 * A home-screen banner.
 *
 * ### 🔴 What `type` + three fields cost
 *
 * This document used to carry `type: "IMAGE"|"VIDEO"|"GIF"` **and** three
 * near-identical subdocuments (`image`, `video`, `gif`), of which exactly one
 * was ever filled. That shape produced, in order:
 *
 *   - a `BANNER_MEDIA_FIELD` lookup table whose only job was turning the enum
 *     back into the field name it had just been derived from;
 *   - a `pre("validate")` hook that re-checked by hand what a `required` should
 *     have done;
 *   - a `set` on `type` to upper-case legacy values, because the enum changed
 *     case after rows existed, and **five** separate reminders in comments that
 *     hydration does not run setters;
 *   - two sources of truth that could disagree — `type: "VIDEO"` with the bytes
 *     sitting in `image`, which nothing prevented and nothing detected.
 *
 * One `media` ends all of it. What the file **is** now lives in `media.kind`,
 * decided once at upload from the verified mime type, and there is no second
 * place for it to disagree with.
 */
const bannerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    redirect: {
      type: {
        // Defaulted to NONE rather than null: null is not one of the enum's own
        // values, so a banner created without a redirect used to answer with a
        // `type` the client could not match against anything. Documents already
        // holding null still validate — mongoose skips the enum check on it.
        type: String,
        enum: Object.values(BANNER_REDIRECT_TYPE),
        default: BANNER_REDIRECT_TYPE.NONE,
      },
      targetId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
      url: {
        type: String,
        default: null,
      },
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    /**
     * The one file this banner shows.
     *
     * `required` rather than a hook: a banner with no media is a blank slot in
     * the carousel, and the old hook threw a raw `Error` (not a 422) from inside
     * validation, so the caller got a 500 for a bad request.
     *
     * ⚠️ The kind check is here **as well as** in the upload helper. The helper
     * guards the HTTP path; this guards every other writer — the seeders, the
     * `replaceBannerMedia` script, and anything written later. A banner is a
     * picture, a clip or an animation; a PDF banner is not a thing.
     */
    media: {
      type: mediaSchema,
      required: [true, "A banner needs a media file."],
      validate: {
        validator: (value) =>
          !value?.kind || BANNER_MEDIA_KINDS.includes(value.kind),
        message: ({ value }) =>
          `A banner cannot be a ${value?.kind}. Use one of: ${BANNER_MEDIA_KINDS.join(", ")}.`,
      },
    },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

bannerSchema.index({ isDeleted: 1, isActive: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model("Banner", bannerSchema);
