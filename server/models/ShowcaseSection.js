const mongoose = require("mongoose");
const { brandField } = require("./validObjectId");
const {
  SHOWCASE_MEDIA_TYPE,
  SHOWCASE_SECTION_TYPE,
  SHOWCASE_COVER_IMAGE_MODE,
  STORAGE_PROVIDER,
} = require("../constants/showcase");

// ---------------------------------------------------------------------------
// A brand's photo / video gallery, one document per section (album).
//
// Two independent visibility rules ride on this shape, and they are the reason
// the read paths differ so much:
//
//   Section.isVisible          — customer sees the section at all.
//   Section.isShowVideosInClips \  both must be true for a video to reach the
//   media.isShowInVideoClips    /  customer's reels feed (double opt-in).
//
// `isActive` / `isDeleted` are operational state, not customer visibility: a
// vendor or admin sees everything that is not deleted so they can toggle it
// back on. Only the customer-facing services narrow further.
// ---------------------------------------------------------------------------

const mediaSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: Object.values(SHOWCASE_MEDIA_TYPE),
      required: true,
    },
    url: { type: String, required: true },
    // For a PHOTO this is the optimised delivery URL (same asset as `url`);
    // for a VIDEO it is the poster frame. Covers always prefer this field.
    thumbnail: { type: String },
    storage: {
      provider: {
        type: String,
        enum: Object.values(STORAGE_PROVIDER),
        default: STORAGE_PROVIDER.CLOUDINARY,
      },
      publicId: { type: String },
      bucket: { type: String },
      key: { type: String },
    },
    metadata: {
      originalName: { type: String },
      mimeType: { type: String },
      format: { type: String },
      size: { type: Number, default: 0 },
      width: { type: Number, default: null },
      height: { type: Number, default: null },
      duration: { type: Number, default: 0 },
    },
    title: { type: String },
    altText: { type: String },
    sortOrder: { type: Number, default: 0 },
    /**
     * VIDEO only. A photo can never appear in the clips feed, so the flag is
     * forced to `false` on anything that is not a VIDEO — see the hook below,
     * `prepareMediaDocuments`, and `updateSectionMedia`, which rejects the
     * field outright for a photo rather than storing a lie.
     */
    isShowInVideoClips: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { _id: true, timestamps: true },
);

// Last line of defence for the VIDEO-only rule: whatever a caller passes, a
// non-video media is stored with the flag off. Runs on `create` and on any
// `parent.save()`; the `$set` paths in the media services enforce it directly.
mediaSchema.pre("validate", function () {
  if (this.type !== SHOWCASE_MEDIA_TYPE.VIDEO) {
    this.isShowInVideoClips = false;
  }
});

const showcaseSectionSchema = new mongoose.Schema(
  {
    brandId: { ...brandField, required: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true },
    description: { type: String, trim: true },
    coverImage: { type: String },
    coverImageMode: {
      type: String,
      enum: Object.values(SHOWCASE_COVER_IMAGE_MODE),
      default: SHOWCASE_COVER_IMAGE_MODE.AUTO,
    },
    sectionType: {
      type: String,
      enum: Object.values(SHOWCASE_SECTION_TYPE),
      default: SHOWCASE_SECTION_TYPE.CUSTOM,
    },
    sortOrder: { type: Number, default: 0 },
    medias: { type: [mediaSchema], default: [] },
    // Customer-facing switch. `isActive` is the vendor's own on/off; this one
    // is "show it on my public profile".
    isVisible: { type: Boolean, default: true },
    // Section half of the clips double opt-in.
    isShowVideosInClips: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

// Indexes are shaped after the three queries that actually run, rather than one
// per field. `brandId` leads all of them, so the standalone `brandId` index it
// used to carry was redundant.
//
// Customer reads — brand's visible sections, in display order.
showcaseSectionSchema.index({
  brandId: 1,
  isDeleted: 1,
  isVisible: 1,
  isActive: 1,
  sortOrder: 1,
});
// Vendor / admin listing and reordering, which do not filter on visibility.
showcaseSectionSchema.index({ brandId: 1, isDeleted: 1, sortOrder: 1 });
// Slug uniqueness is resolved per brand in `generateUniqueSlug`.
showcaseSectionSchema.index({ brandId: 1, slug: 1 });

module.exports = mongoose.model("ShowcaseSection", showcaseSectionSchema);
