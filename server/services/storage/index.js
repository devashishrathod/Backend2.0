const path = require("path");

const { config } = require("../../configs/env");
const { DEFAULT_IMAGES } = require("../../constants");
const {
  STORAGE_PROVIDER,
  MEDIA_KIND,
  UPLOAD_PURPOSE,
  kindFromMime,
} = require("../../constants/storage");
const { throwError } = require("../../utils");
const { getStorageConfig } = require("../../helpers/settings");

const cloudinaryProvider = require("./providers/cloudinary");
const s3Provider = require("./providers/s3");

/**
 * One place that knows where media lives.
 *
 * Before this, every surface answered that question for itself, and each one
 * answered it slightly differently — `helpers/showcases/upload.js` had a
 * `switch` with an empty `case "S3"`, `helpers/vouchers` deleted by URL, and
 * `helpers/cloudinary/deleteFile` quietly did nothing at all when handed a URL
 * it did not recognise. Three different ways to not delete a file, none of them
 * raising anything.
 *
 * The rule here is the opposite: a delete either happens or it throws.
 */

const PROVIDERS = Object.freeze({
  [STORAGE_PROVIDER.CLOUDINARY]: cloudinaryProvider,
  [STORAGE_PROVIDER.AWS_S3]: s3Provider,
});

/**
 * Which provider new uploads go to.
 *
 * ⚠️ **From `Setting.storage.provider`, not from the environment** — which is
 * why this is async where it used to be a plain read.
 *
 * `MEDIA_PROVIDER` still exists, but only as the value a brand-new install is
 * **seeded** with (see the model). After that the admin owns it, and
 * redeploying with a different env var does not quietly override what they
 * chose. Two sources for one answer is only safe when it is written down which
 * of them wins.
 */
const activeProvider = async () => {
  const { provider } = await getStorageConfig();
  return provider || STORAGE_PROVIDER.CLOUDINARY;
};

/**
 * Which provider an **existing** asset lives on.
 *
 * ⚠️ Not `activeProvider()`. Rows written before the switch still point at the
 * old provider, and deleting them has to follow the row, not the setting. A
 * row with no `storage` at all predates the field entirely, and everything from
 * that era is on Cloudinary — S3 did not exist yet.
 */
const providerFor = (asset) => {
  const name = asset?.storage?.provider ?? STORAGE_PROVIDER.CLOUDINARY;
  const provider = PROVIDERS[name];
  if (!provider) {
    // 🔴 Never a warn-and-return. An unknown provider means the row and the
    // code disagree about reality, and continuing quietly is how an asset gets
    // stranded forever with a `console.warn` as its only trace.
    throwError(500, `Unknown storage provider: ${name}`);
  }
  return provider;
};

/** PHOTO/VIDEO is the showcase's vocabulary; this maps it onto ours. */
const KIND_BY_MEDIA_TYPE = Object.freeze({
  PHOTO: MEDIA_KIND.IMAGE,
  VIDEO: MEDIA_KIND.VIDEO,
  GIF: MEDIA_KIND.GIF,
  IMAGE: MEDIA_KIND.IMAGE,
});

const EXT_KIND = Object.freeze({
  gif: MEDIA_KIND.GIF,
  mp4: MEDIA_KIND.VIDEO,
  webm: MEDIA_KIND.VIDEO,
  mov: MEDIA_KIND.VIDEO,
  pdf: MEDIA_KIND.DOCUMENT,
  mp3: MEDIA_KIND.AUDIO,
  m4a: MEDIA_KIND.AUDIO,
  wav: MEDIA_KIND.AUDIO,
});

/**
 * What kind of thing this asset is.
 *
 * It matters more than it looks: Cloudinary needs the right `resource_type` to
 * delete at all — asking it to destroy a video as an image returns "not found"
 * and the file stays. So this walks from the most reliable evidence to the
 * least, rather than assuming.
 *
 * ⚠️ The mime check runs before the type check because a GIF is stored with
 * `type: "IMAGE"` on a banner while being its own kind to us.
 */
const resolveKind = (asset) => {
  if (asset?.kind && MEDIA_KIND[asset.kind]) return asset.kind;

  const fromMime = kindFromMime(asset?.metadata?.mimeType);
  if (fromMime) return fromMime;

  const fromType = KIND_BY_MEDIA_TYPE[asset?.type];
  if (fromType) return fromType;

  const source = asset?.storage?.key || asset?.url || "";
  const ext = path.extname(String(source).split("?")[0]).slice(1).toLowerCase();
  return EXT_KIND[ext] || MEDIA_KIND.IMAGE;
};

const activeProviderModule = async () => {
  const name = await activeProvider();
  const provider = PROVIDERS[name];
  if (!provider) {
    throwError(500, `Setting.storage.provider is not a known provider: ${name}`);
  }
  return provider;
};

/**
 * Upload a file that is already on disk.
 *
 * `purpose` and `entityId` decide the key. Callers that do not yet know either
 * — step A of the migration, where signatures have not changed — pass
 * `LEGACY`, which keeps them landing exactly where they land today.
 */
exports.uploadFromPath = async ({
  filePath,
  purpose = UPLOAD_PURPOSE.LEGACY,
  entityId = null,
  originalFile = null,
  kind = null,
  publicId = null,
  key = null,
}) => {
  if (!filePath) throwError(400, "A file is required.");

  const resolved =
    kind || kindFromMime(originalFile?.mimetype) || MEDIA_KIND.IMAGE;

  const provider = await activeProviderModule();
  return provider.upload({
    filePath,
    purpose,
    entityId,
    kind: resolved,
    originalFile,
    publicId,
    key,
  });
};

// `uploadUrl` lived here for one step: the surfaces that stored a bare URL
// string had nowhere to put a `storage` object, so a URL-only helper kept their
// call sites short. They all have a sibling field now, and every one of them
// wants both halves — so the helper had no callers left.

/**
 * Every shared placeholder, as a set of URLs.
 *
 * 🔴 `Category.image` and `SubCategory.image` **default** to one of these, so a
 * row that never had a picture of its own still carries a URL — and one URL is
 * carried by every such row at once. Deleting it would blank the tile on every
 * category using the default, from a single ordinary delete.
 *
 * Today that is prevented by an accident: the defaults live on an old
 * Cloudinary cloud (`drvdnqydw`) while the active one is different, so the host
 * comparison inside `deleteFile` refuses them. The day somebody re-uploads
 * these to the current cloud — a perfectly reasonable thing to do — the
 * accident stops protecting anything. This does not depend on where they are
 * hosted.
 */
const SHARED_DEFAULTS = new Set(Object.values(DEFAULT_IMAGES));

/**
 * Delete an asset, whoever is holding it.
 *
 * Accepts the shape the callers actually have — a media object with `url`,
 * `storage` and sometimes `type` — rather than a bare `storage`, because every
 * one of them would otherwise have to reach inside and pick it apart first.
 *
 * Returns whether something was deleted. Throws if it could not tell how.
 */
exports.deleteAsset = async (asset) => {
  if (!asset) return false;
  if (!asset.url && !asset.storage?.key && !asset.storage?.publicId) {
    // Nothing to act on. Not an error: a row can legitimately have an empty
    // media slot, and callers delete optimistically.
    return false;
  }
  // A row holding a shared placeholder does not own it. Refusing here rather
  // than at each call site means a new surface cannot reintroduce the bug.
  if (asset.url && SHARED_DEFAULTS.has(asset.url)) return false;

  return providerFor(asset).remove({
    storage: asset.storage,
    url: asset.url,
    kind: resolveKind(asset),
  });
};

/**
 * Delete several, and do not let one failure hide the rest.
 *
 * `Promise.allSettled` so a single bad row cannot stop the others, but the
 * rejections are counted and reported — the old code logged each one and
 * returned as though the batch had worked.
 */
exports.deleteAssets = async (assets = []) => {
  const targets = (assets || []).filter(Boolean);
  if (!targets.length) return { deleted: 0, failed: 0 };

  const results = await Promise.allSettled(
    targets.map((asset) => exports.deleteAsset(asset)),
  );

  let deleted = 0;
  let failed = 0;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      if (result.value) deleted += 1;
      return;
    }
    failed += 1;
    const target = targets[index];
    console.error(
      `Storage delete failed for ${target?.storage?.key || target?.url}:`,
      result.reason?.message || result.reason,
    );
  });

  return { deleted, failed };
};

/** The URL a customer should be served. */
exports.publicUrl = (asset) => {
  if (!asset) return null;
  return providerFor(asset).url({ storage: asset.storage, url: asset.url });
};

/**
 * A link to one document, minted now.
 *
 * 🔴 **Never stored.** A document's URL used to be cached on the record, and
 * that cached string was the hole: it was public, permanent and built from
 * `Math.random()`, and it carried the customer's name, address, GSTIN and
 * amount. `documentToken` can be revoked; a URL already sitting in somebody's
 * WhatsApp history cannot. So the record remembers the **key**, and the link is
 * made fresh for each request and expires in minutes.
 *
 * On Cloudinary there is nothing short-lived to mint — its delivery URL is the
 * only one there is. That is the old behaviour, unchanged, and it is why this
 * finding is only really closed once documents live on S3.
 */
exports.documentUrl = async (asset) => {
  if (!asset?.storage) return asset?.url ?? null;

  const provider = providerFor(asset);
  if (provider.signedGetUrl) return provider.signedGetUrl({ storage: asset.storage });

  return provider.url({ storage: asset.storage, url: asset.url });
};

exports.resolveKind = resolveKind;
exports.activeProvider = activeProvider;

/**
 * 🔴 Direct-to-S3 upload (U-1) — re-exported here rather than imported from
 * their own files, so every caller keeps going through one door.
 *
 * ⚠️ These two are **S3-only**, unlike everything above them. `presign` is
 * built on `@aws-sdk/s3-presigned-post` and Cloudinary has no equivalent, so a
 * platform running on Cloudinary keeps using the multipart path until U-5
 * retires it. Reads and deletes stay provider-agnostic either way — see §0.5
 * of the execution plan for why production is S3-only from day one.
 */
const { createUploadIntent, PRESIGN_TTL_SECONDS } = require("./presign");
const { confirmUpload } = require("./confirm");

exports.createUploadIntent = createUploadIntent;
exports.confirmUpload = confirmUpload;
exports.PRESIGN_TTL_SECONDS = PRESIGN_TTL_SECONDS;
