const mongoose = require("mongoose");

const { STORAGE_PROVIDER, MEDIA_KIND } = require("../constants/storage");

/**
 * One stored file, described the same way everywhere.
 *
 * ### 🔴 What this replaces
 *
 * A sweep of `models/` found **three** shapes for the same idea:
 *
 *     A — sidecar   `logo: String` + `logoStorage: storageSchema`
 *                   Brand ×2, SubBrand ×2, Category, SubCategory,
 *                   BrandFeatures, User, and four document surfaces
 *
 *     B — nested    `image: { url, storage: { provider, publicId, … } }`
 *                   Banner ×3, PromotionalTicker, Voucher.banner ×3,
 *                   VoucherVersion.images[], ShowcaseSection.medias[]
 *
 *     C — nothing   `Customer.image: String`, with no storage detail at all
 *
 * Shape B carried `enum: ["CLOUDINARY", "S3"]` written out by hand in **five**
 * places, so `STORAGE_PROVIDER` was not the single source it looks like. And
 * `sizeBytes`, `width`, `height`, `duration` and `mimeType` existed only on
 * showcase media — everywhere else the platform stored a URL and knew nothing
 * else about the file it was serving.
 *
 * ### The two levels, and why they are separate
 *
 * `storageRefSchema` answers **where the bytes are** — that is all a delete
 * needs. `mediaSchema` answers **what the file is**, which is what a renderer
 * needs. Keeping them apart is what lets a poster carry a locator without
 * dragging a second set of dimensions and a second `kind` behind it.
 *
 * ### ⚠️ This is a storage shape, not a response shape
 *
 * Nothing here goes to a client directly. `helpers/media/toMediaResponse.js`
 * decides what leaves the server, and it never emits `storage` — which is the
 * structural answer to the leaks found in the voucher detail and the ticker
 * feed, where a public endpoint handed out bucket names and object keys.
 */

/** Where the bytes are. Everything a delete needs, and nothing else. */
const storageRefSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: Object.values(STORAGE_PROVIDER),
      required: true,
    },
    /** Cloudinary's handle. Null on S3. */
    publicId: { type: String },
    /** S3 only. */
    bucket: { type: String },
    key: { type: String },
  },
  { _id: false },
);

/**
 * A video's poster frame.
 *
 * Deliberately smaller than `mediaSchema`: a poster is always an image, and a
 * poster never has a poster of its own — so giving it the full shape would add
 * a `kind` that is always `IMAGE` and a `poster` that is always absent.
 */
const posterSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    storage: { type: storageRefSchema, default: undefined },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
  },
  { _id: false },
);

const mediaSchema = new mongoose.Schema(
  {
    /** What a client fetches. */
    url: { type: String, required: true, trim: true },

    /**
     * ⚠️ `default: undefined`, always.
     *
     * A Mongoose sub-document without it materialises as `{}` on every
     * document, and `{}` reads as `provider: undefined` — which the storage
     * facade refuses with "Unknown storage provider". Absent means "written
     * before this existed, work it out from the URL"; `{}` means "written by
     * something broken".
     */
    storage: { type: storageRefSchema, default: undefined },

    /**
     * What the file **is**, decided once at upload from the bytes.
     *
     * 🔴 Today every surface answers this for itself, with
     * `mimetype.startsWith("image")` — which is how a GIF quietly becomes a
     * `PHOTO`, and how it ends up somewhere the resize step will flatten its
     * animation. Written down once, the question stops being asked again.
     */
    kind: {
      type: String,
      enum: Object.values(MEDIA_KIND),
      required: true,
    },

    mimeType: { type: String },
    sizeBytes: { type: Number, default: 0 },
    /** Image and video. */
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    /** Video and audio, in seconds. */
    duration: { type: Number, default: 0 },
    /** What the uploader called it. Shown in the panel, never to a customer. */
    originalName: { type: String },

    /**
     * 🔴 Required on a VIDEO.
     *
     * A video with no poster is a player that opens on a blank frame, and every
     * card that tries to render it shows either nothing or a link to the `.mp4`.
     * Both providers have produced exactly that:
     *
     *   - **S3** returns no poster at all, so a cover computed as
     *     `thumbnail || url` becomes the video file itself.
     *   - **Cloudinary** looked like it produced one, but
     *     `getOptimizedImageUrl(publicId)` builds an **`/image/upload/`** path
     *     for an asset that lives under `/video/upload/`. That URL 404s. A real
     *     video poster needs `resource_type: "video"` and `format: "jpg"`.
     *
     * So a poster is never derived. It is uploaded alongside the video, on both
     * providers, and this is the field it lands in.
     *
     * ⚠️ Conditionally **required**, not checked in a hook.
     *
     * A `pre("validate")` hook that calls `this.invalidate()` on a single nested
     * sub-document does not reach the parent's error list — measured: a VIDEO
     * with no poster validated completely clean. A `required` function does,
     * and it also gives the right path (`…poster`) so the message lands on the
     * field the caller has to fix.
     *
     * On the sub-schema rather than in each service, because there are eighteen
     * upload call sites, and a rule enforced in eighteen places is a rule that
     * will be missing from one of them.
     */
    poster: {
      type: posterSchema,
      default: undefined,
      required: [
        function () {
          return this.kind === MEDIA_KIND.VIDEO;
        },
        "A video needs a poster image. Upload one alongside the video.",
      ],
    },
  },
  { _id: false },
);

module.exports = { mediaSchema, posterSchema, storageRefSchema };
