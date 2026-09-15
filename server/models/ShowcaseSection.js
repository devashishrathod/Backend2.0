const mongoose = require("mongoose");
const { brandField } = require("./validObjectId");
const {
  SHOWCASE_SECTION_TYPE,
  SHOWCASE_COVER_IMAGE_MODE,
} = require("../constants/showcase");
const { MEDIA_KIND } = require("../constants/storage");
const { mediaSchema } = require("./mediaSchema");

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

/**
 * One item in a brand's gallery.
 *
 * ### 🔴 The file and the gallery entry are two different things
 *
 * This used to be one flat shape holding both: `type` / `url` / `thumbnail` /
 * `thumbnailStorage` / `storage` / `metadata` described the **file**, while
 * `title` / `altText` / `sortOrder` / `isShowInVideoClips` described its **place
 * in the album**. Mixing them is what produced the platform's only per-surface
 * copy of file metadata — `metadata.size`, `metadata.width` and friends existed
 * here and nowhere else, so every other surface stored a URL and knew nothing
 * about the bytes behind it.
 *
 * Now the file lives in `media`, exactly the `mediaSchema` every other surface
 * uses, and the gallery's own fields sit beside it.
 *
 * ### ⚠️ There is no `type` field any more
 *
 * The wire still answers `PHOTO` / `VIDEO` (locked: S-7 — a GIF reads as a
 * PHOTO), but that value is **derived from `media.kind` at read time**, never
 * stored. A stored copy is a second source of truth that can disagree with the
 * bytes it describes, which is exactly the bug the banner carried for months.
 * `media.kind` additionally keeps the finer answer — `GIF` is distinct from
 * `IMAGE` there, which is what routes it clear of the resize step.
 */
const showcaseMediaSchema = new mongoose.Schema(
  {
    /**
     * The file. `poster` inside it is mandatory on a VIDEO, which is what
     * replaces the old `thumbnail` + `thumbnailStorage` pair.
     *
     * 🔴 Those two existed to answer "did the vendor upload this poster, or did
     * we derive it?" — a question with no good answer. On Cloudinary it meant
     * comparing the stored URL against `getOptimizedImageUrl(publicId)`; on S3
     * `publicId` is null so the comparison was skipped and **every** derived
     * poster read as custom, which meant changing a video's poster deleted the
     * one the vendor was still looking at. A poster is never derived now, so the
     * question does not exist.
     */
    media: { type: mediaSchema, required: [true, "A media file is required."] },
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
showcaseMediaSchema.pre("validate", function () {
  if (this.media?.kind !== MEDIA_KIND.VIDEO) {
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
    /**
     * Which media the vendor pinned, when `coverImageMode` is MANUAL.
     *
     * ⚠️ The id, not the URL. A pin means "show *this* media", so replacing that
     * media's file must keep the pin and follow the new picture — a URL would
     * silently stop matching and the cover would jump elsewhere. It is also what
     * lets `syncSectionCoverImage` notice that a pinned media has been deleted
     * or hidden, which is the only way the cover can fall back instead of
     * pointing at something the customer can no longer see.
     */
    coverMediaId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
    sectionType: {
      type: String,
      enum: Object.values(SHOWCASE_SECTION_TYPE),
      default: SHOWCASE_SECTION_TYPE.CUSTOM,
    },
    sortOrder: { type: Number, default: 0 },
    medias: { type: [showcaseMediaSchema], default: [] },
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
