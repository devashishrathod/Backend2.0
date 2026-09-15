const fs = require("fs");

const {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

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
    provider: STORAGE_PROVIDER.AWS_S3,
    publicId: null,
    bucket: bucketName(bucket),
    key,
  };

  return {
    /**
     * 🔴 `null` for a private object, not a thrown error.
     *
     * `exports.url` refuses a private bucket on purpose — there is no lasting
     * link to one, and handing out a guessable path would defeat the bucket.
     * But calling it unconditionally here made **every document upload throw**
     * the moment the provider was S3: invoices, settlements, refunds and
     * chargebacks all render into the private bucket.
     *
     * Nothing caught it because the provider was still Cloudinary and the
     * document tests mock the upload. `documentUrl` mints a presigned GET per
     * request from `storage`, so a null here is the correct answer rather than
     * a missing one.
     */
    url: isPublic ? exports.url({ storage }) : null,
    /**
     * 🔴 `thumbnail` is gone from here too (M-4).
     *
     * It never had anything to return for a video — S3 produces no poster — and
     * for a photo it was the delivery URL a second time. The comment that used
     * to sit here claimed a missing thumbnail made `syncSectionCoverImage`
     * "fall through to the next visible media"; it did not. `getMediaCoverImage`
     * was `thumbnail || url`, so a video-first section's cover became the `.mp4`
     * itself.
     *
     * A poster is uploaded alongside the video now, on both providers, and lives
     * in `mediaSchema.poster`.
     */
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

/**
 * How long a minted document link stays valid.
 *
 * Long enough for a browser to follow a redirect and finish a download on a bad
 * connection; short enough that a link pasted into a support chat or forwarded
 * on WhatsApp is dead by the time anybody else opens it. That forwarding is not
 * hypothetical — it is the normal life of these links, and it is the whole
 * reason the permanent public URL had to go.
 */
const PRESIGNED_GET_TTL_SECONDS = 5 * 60;

/**
 * A short-lived link to one private object.
 *
 * 🔴 The only way to read a private object. A document's URL is **minted per
 * request** rather than stored: storing one would recreate exactly the problem
 * the private bucket exists to solve — a link that outlives the permission
 * behind it. `documentToken` can be revoked; a URL already in somebody's
 * message history cannot.
 */
exports.signedGetUrl = async ({ storage, expiresIn = PRESIGNED_GET_TTL_SECONDS }) => {
  if (!storage?.key) throwError(500, "Cannot sign a URL without a key.");

  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: storage.bucket || bucketName(STORAGE_BUCKET.PRIVATE),
      Key: storage.key,
    }),
    { expiresIn },
  );
};

exports.PRESIGNED_GET_TTL_SECONDS = PRESIGNED_GET_TTL_SECONDS;

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
