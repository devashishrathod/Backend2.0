const fs = require("fs");

const {
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const { getS3Client, bucketName } = require("../../../configs/s3");
const { config } = require("../../../configs/env");
const {
  STORAGE_PROVIDER,
  STORAGE_BUCKET,
  MEDIA_KIND,
} = require("../../../constants/storage");
const { buildKey, bucketFor } = require("../keys");
const { throwError } = require("../../../utils");

/**
 * The S3 provider.
 *
 * Deliberately thin: a key, a bucket, and the bytes. Everything that decides
 * *which* key lives in `keys.js`, and everything that decides *which provider*
 * lives in the facade.
 */

/**
 * A year, and `immutable`.
 *
 * Safe only because keys are never reused — every upload gets a fresh uuid, so
 * a URL that exists always points at the same bytes. The moment a key were
 * reused this would serve stale media for a year with no way to tell.
 */
const PUBLIC_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Documents must never be cached by a shared cache. */
const PRIVATE_CACHE_CONTROL = "private, no-store";

const contentTypeFor = (originalFile, kind) => {
  const claimed = originalFile?.mimetype;
  if (claimed) return claimed;
  // Last resort. A wrong Content-Type is cached by CloudFront for as long as
  // the object lives, so it is worth being explicit rather than letting S3
  // default to application/octet-stream.
  if (kind === MEDIA_KIND.DOCUMENT) return "application/pdf";
  return "application/octet-stream";
};

exports.upload = async ({
  filePath,
  purpose,
  entityId,
  kind,
  originalFile,
  key: providedKey,
}) => {
  const bucket = bucketFor(purpose);
  const key =
    providedKey ||
    buildKey({
      purpose,
      entityId,
      kind,
      mime: originalFile?.mimetype,
      originalName: originalFile?.name,
    });

  const stats = fs.statSync(filePath);
  const isPublic = bucket === STORAGE_BUCKET.PUBLIC;

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucketName(bucket),
      Key: key,
      Body: fs.createReadStream(filePath),
      // S3 needs the length up front for a single-part PUT; without it the SDK
      // has to buffer the whole file to work it out.
      ContentLength: stats.size,
      ContentType: contentTypeFor(originalFile, kind),
      CacheControl: isPublic ? PUBLIC_CACHE_CONTROL : PRIVATE_CACHE_CONTROL,
    }),
  );

  const storage = {
    provider: STORAGE_PROVIDER.S3,
    publicId: null,
    bucket: bucketName(bucket),
    key,
  };

  return {
    url: exports.url({ storage }),
    // ⚠️ A video has no poster until the metadata Lambda makes one (Phase 7).
    // Claiming the video's own URL as its thumbnail would put an un-playable
    // tile in every cover slot, so this stays empty and `syncSectionCoverImage`
    // falls through to the next visible media.
    thumbnail: kind === MEDIA_KIND.VIDEO ? null : exports.url({ storage }),
    storage,
    metadata: {
      originalName: originalFile?.name ?? null,
      mimeType: originalFile?.mimetype ?? null,
      format: key.split(".").pop() || null,
      size: stats.size,
      // Dimensions arrive with the magic-byte header parse in Phase 5; nothing
      // here has read the bytes, so reporting a number would be inventing one.
      width: null,
      height: null,
      duration: 0,
    },
  };
};

exports.remove = async ({ storage }) => {
  if (!storage?.key) return false;

  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: storage.bucket || bucketName(STORAGE_BUCKET.PUBLIC),
      Key: storage.key,
    }),
  );
  // S3 deletes are idempotent — a missing key is a success, which is the same
  // thing Cloudinary's "not found" means.
  return true;
};

/**
 * The delivery URL.
 *
 * 🔴 Public objects only. A private object's URL is a presigned GET with a
 * short expiry, minted per request (Phase 4) — building a plain URL for one
 * here would produce a link that 403s, or worse, one that works.
 */
exports.url = ({ storage }) => {
  if (!storage?.key) return null;

  const privateBucket = config.S3_BUCKET_PRIVATE;
  if (privateBucket && storage.bucket === privateBucket) {
    throwError(
      500,
      "A private object has no public URL — mint a presigned GET instead.",
    );
  }

  if (config.CDN_BASE_URL) {
    return `${config.CDN_BASE_URL.replace(/\/+$/, "")}/${storage.key}`;
  }
  return `https://${storage.bucket}.s3.${config.AWS_REGION}.amazonaws.com/${storage.key}`;
};
