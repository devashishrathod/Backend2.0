/**
 * Where a file lives, and where inside the bucket it goes.
 *
 * ### Why the key shape is `<type>/<entity>/<entityId>/<uuid>.<ext>`
 *
 * **Type on the outside** because three pieces of infrastructure can only be
 * pointed at a prefix:
 *
 *   - the resize Lambda's CloudFront behaviour fires on `images/*`
 *   - the Infrequent-Access lifecycle rule targets `videos/*`, which is where
 *     all the large objects are
 *   - `gifs/*` is deliberately **outside** `images/*`, because resizing an
 *     animated GIF flattens the animation. A GIF is an `image/*` mime type and
 *     passes every "is this an image" check in the codebase, so the prefix is
 *     the only thing that reliably keeps it away from the resizer.
 *
 * **Entity on the inside** because today nothing does. Cloudinary puts every
 * upload in a flat `Images` folder under a random public id, so an object on
 * its own cannot say which brand or voucher it belongs to — which is why
 * `scripts/cleanupOrphans.js` sweeps rows but never storage. With the id in the
 * key, an orphan sweep becomes possible.
 *
 * ⚠️ `AUDIO` has a row here and will never have an object under it until
 * something calls `uploadAudio`, which nothing does. The row exists so the
 * table is complete, not because the folder is expected.
 */

const STORAGE_PROVIDER = Object.freeze({
  CLOUDINARY: "CLOUDINARY",
  S3: "S3",
});

/**
 * What the bytes actually are — decided from the verified mime type, never from
 * the file name and never from what the client claimed.
 */
const MEDIA_KIND = Object.freeze({
  IMAGE: "IMAGE",
  VIDEO: "VIDEO",
  GIF: "GIF",
  AUDIO: "AUDIO",
  DOCUMENT: "DOCUMENT",
});

/** The first segment of every key. Lowercase: it is a path, not an enum. */
const MEDIA_KIND_PREFIX = Object.freeze({
  [MEDIA_KIND.IMAGE]: "images",
  [MEDIA_KIND.VIDEO]: "videos",
  [MEDIA_KIND.GIF]: "gifs",
  [MEDIA_KIND.AUDIO]: "audio",
  [MEDIA_KIND.DOCUMENT]: "documents",
});

/** Which bucket a purpose belongs in. Not a folder — a different bucket. */
const STORAGE_BUCKET = Object.freeze({
  PUBLIC: "PUBLIC",
  PRIVATE: "PRIVATE",
});

/**
 * ⚠️ A GIF is `image/gif`. Anything that only asks `mimetype.startsWith("image")`
 * will call it an image, so the GIF check has to come first.
 */
const kindFromMime = (mime) => {
  const value = String(mime || "").toLowerCase();
  if (value === "image/gif") return MEDIA_KIND.GIF;
  if (value === "application/pdf") return MEDIA_KIND.DOCUMENT;
  if (value.startsWith("image/")) return MEDIA_KIND.IMAGE;
  if (value.startsWith("video/")) return MEDIA_KIND.VIDEO;
  if (value.startsWith("audio/")) return MEDIA_KIND.AUDIO;
  return null;
};

/**
 * Every upload surface in the app, and the one place that says where it lands.
 *
 * `entity` is the key segment; `kinds` is what that surface can **route**. A
 * purpose that accepts several kinds (a banner can be an image, a video or a
 * GIF) still ends up under exactly one type prefix, chosen per file from the
 * verified mime type.
 *
 * ⚠️ `kinds` is routing and a sanity check, **not** the security boundary. The
 * mime allow-lists — `BANNER_ALLOWED_MIME_TYPES`, `SHOWCASE_MEDIA_CONFIG`,
 * `TICKER_ICON_ALLOWED_MIME_TYPES` and the per-surface validators — decide what
 * a caller may send. That is why every image surface lists `GIF` as well: a GIF
 * *is* an `image/*` file, several surfaces accept one today (voucher images
 * check only `startsWith("image/")`, and the logo and avatar paths check
 * nothing at all — see `media_upload_map.md` §8.4), and refusing to route one
 * here would turn an accepted upload into a confusing 422 the moment S3 became
 * the provider. Listing it keeps the GIF going where it belongs — `gifs/`,
 * clear of the resize Lambda — rather than pretending it cannot arrive.
 */
const UPLOAD_PURPOSE = Object.freeze({
  BRAND_LOGO: "BRAND_LOGO",
  BRAND_FEATURE_ICON: "BRAND_FEATURE_ICON",
  CATEGORY_IMAGE: "CATEGORY_IMAGE",
  SUBCATEGORY_IMAGE: "SUBCATEGORY_IMAGE",
  USER_AVATAR: "USER_AVATAR",
  SHOWCASE_MEDIA: "SHOWCASE_MEDIA",
  SHOWCASE_THUMBNAIL: "SHOWCASE_THUMBNAIL",
  BANNER_MEDIA: "BANNER_MEDIA",
  VOUCHER_IMAGE: "VOUCHER_IMAGE",
  VOUCHER_BANNER: "VOUCHER_BANNER",
  TICKER_ICON: "TICKER_ICON",
  DOCUMENT: "DOCUMENT",
  AUDIO: "AUDIO",
  /**
   * Callers that have not been told what they are uploading yet.
   *
   * Phase 2 step A moves every call site onto the facade without changing its
   * signature, so for one step they cannot name a purpose or an id. Those
   * uploads keep landing exactly where they land today. Step B removes this.
   */
  LEGACY: "LEGACY",
});

const { IMAGE, VIDEO, GIF, AUDIO, DOCUMENT } = MEDIA_KIND;

const UPLOAD_PURPOSES = Object.freeze({
  [UPLOAD_PURPOSE.BRAND_LOGO]: {
    entity: "brands",
    bucket: STORAGE_BUCKET.PUBLIC,
    kinds: [IMAGE, GIF],
  },
  [UPLOAD_PURPOSE.BRAND_FEATURE_ICON]: {
    entity: "brand-features",
    bucket: STORAGE_BUCKET.PUBLIC,
    kinds: [IMAGE, GIF],
  },
  [UPLOAD_PURPOSE.CATEGORY_IMAGE]: {
    entity: "categories",
    bucket: STORAGE_BUCKET.PUBLIC,
    kinds: [IMAGE, GIF],
  },
  [UPLOAD_PURPOSE.SUBCATEGORY_IMAGE]: {
    entity: "subcategories",
    bucket: STORAGE_BUCKET.PUBLIC,
    kinds: [IMAGE, GIF],
  },
  [UPLOAD_PURPOSE.USER_AVATAR]: {
    entity: "users",
    bucket: STORAGE_BUCKET.PUBLIC,
    kinds: [IMAGE, GIF],
  },
  [UPLOAD_PURPOSE.SHOWCASE_MEDIA]: {
    entity: "showcase",
    bucket: STORAGE_BUCKET.PUBLIC,
    kinds: [IMAGE, GIF, VIDEO],
  },
  [UPLOAD_PURPOSE.SHOWCASE_THUMBNAIL]: {
    entity: "showcase",
    bucket: STORAGE_BUCKET.PUBLIC,
    kinds: [IMAGE, GIF],
  },
  [UPLOAD_PURPOSE.BANNER_MEDIA]: {
    entity: "banners",
    bucket: STORAGE_BUCKET.PUBLIC,
    kinds: [IMAGE, VIDEO, GIF],
  },
  [UPLOAD_PURPOSE.VOUCHER_IMAGE]: {
    entity: "vouchers",
    bucket: STORAGE_BUCKET.PUBLIC,
    kinds: [IMAGE, GIF],
  },
  [UPLOAD_PURPOSE.VOUCHER_BANNER]: {
    entity: "vouchers",
    bucket: STORAGE_BUCKET.PUBLIC,
    kinds: [IMAGE, VIDEO, GIF],
  },
  [UPLOAD_PURPOSE.TICKER_ICON]: {
    entity: "tickers",
    bucket: STORAGE_BUCKET.PUBLIC,
    kinds: [IMAGE, GIF],
  },
  /** 🔴 The only PRIVATE one. Invoices carry name, address, GSTIN and amount. */
  [UPLOAD_PURPOSE.DOCUMENT]: {
    entity: "documents",
    bucket: STORAGE_BUCKET.PRIVATE,
    kinds: [DOCUMENT],
  },
  [UPLOAD_PURPOSE.AUDIO]: {
    entity: "misc",
    bucket: STORAGE_BUCKET.PUBLIC,
    kinds: [AUDIO],
  },
  [UPLOAD_PURPOSE.LEGACY]: {
    entity: "misc",
    bucket: STORAGE_BUCKET.PUBLIC,
    kinds: [IMAGE, VIDEO, GIF, AUDIO, DOCUMENT],
  },
});

/**
 * What counts as an image anywhere a surface has no allow-list of its own.
 *
 * 🔴 `mimetype.startsWith("image/")` is **not** a safe test, and six upload
 * paths used to do exactly that or no test at all. `image/svg+xml` passes it,
 * and an SVG is an XML document that can carry a `<script>`. Today those are
 * served from a Cloudinary domain, so a panel session is cross-origin and out
 * of reach — but the moment media moves to our own CDN, and especially if that
 * CDN is ever a subdomain of a panel, the same file is stored XSS.
 *
 * ⚠️ GIF is in, and deliberately: voucher images accept one today and removing
 * it would be a product change, not a security fix. It routes to `gifs/`, clear
 * of the resize Lambda.
 *
 * ⚠️ And this is still only the **declared** type, which the client writes. The
 * real fix is reading the file's magic bytes, which arrives with the presigned
 * upload flow. This closes the front door; it is not the whole lock.
 */
const IMAGE_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * Cloudinary has folders rather than keys, and the ones below are the folders
 * it has been writing to since before any of this existed. Step A must not move
 * a single existing asset, so `LEGACY` keeps pointing at them.
 */
const CLOUDINARY_LEGACY_FOLDER = Object.freeze({
  [MEDIA_KIND.IMAGE]: "Images",
  [MEDIA_KIND.GIF]: "Images",
  [MEDIA_KIND.VIDEO]: "Videos",
  [MEDIA_KIND.AUDIO]: "Audio",
  [MEDIA_KIND.DOCUMENT]: "Documents",
});

module.exports = {
  STORAGE_PROVIDER,
  MEDIA_KIND,
  MEDIA_KIND_PREFIX,
  STORAGE_BUCKET,
  UPLOAD_PURPOSE,
  UPLOAD_PURPOSES,
  CLOUDINARY_LEGACY_FOLDER,
  IMAGE_MIME_TYPES,
  kindFromMime,
};
