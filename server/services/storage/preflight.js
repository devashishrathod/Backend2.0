const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const { getS3Client, bucketName } = require("../../configs/s3");
const { STORAGE_BUCKET, STORAGE_PROVIDER } = require("../../constants/storage");
const { prefix } = require("./keys");
const { config } = require("../../configs/env");

/**
 * Prove the platform can actually write to S3 — before anyone depends on it.
 *
 * ### 🔴 Why a switch needs a rehearsal
 *
 * `Setting.storage.provider` is one dropdown in the admin panel, and flipping it
 * redirects **every upload on the platform**: avatars, banners, voucher images,
 * generated invoices. If the credentials are wrong, or the bucket name has a
 * typo, or the IAM policy was never attached, then nothing fails at save time —
 * it fails at the next upload, for every user at once, with a stack trace that
 * says nothing about a settings change made an hour ago.
 *
 * An env var at least needed someone with deploy access. A dropdown does not.
 * So the dropdown gets a rehearsal instead.
 *
 * ### ⚠️ Why the probe writes, and why nothing lighter works
 *
 * The read-only checks all lie, for reasons worth writing down:
 *
 *   - **`HeadBucket`** needs `s3:ListBucket`, which this policy deliberately
 *     withholds — so it fails on a **correct** setup.
 *   - **`HeadObject`** on a missing key returns no response body at all, so the
 *     SDK cannot read an error code and everything surfaces as `Unknown`.
 *   - **`GetObject`** on a missing key is the real trap: without
 *     `s3:ListBucket`, S3 answers `AccessDenied` instead of `NoSuchKey`. That is
 *     also what a broken policy returns, so the two are indistinguishable — a
 *     perfectly configured bucket looks identical to an unconfigured one.
 *
 * A round trip has no such ambiguity. It exercises exactly the three permissions
 * the app uses, and each of them for real.
 *
 * The object is tiny, lands under `staging/` where the bucket's lifecycle rule
 * would sweep it anyway, and is deleted on the way out.
 */

/** Both buckets, because documents and media do not share one. */
const BUCKETS = [STORAGE_BUCKET.PUBLIC, STORAGE_BUCKET.PRIVATE];

const probeBucket = async (client, bucket) => {
  const key = `${prefix()}staging/__preflight_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}.txt`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: "trydood storage preflight",
      ContentType: "text/plain",
    }),
  );

  try {
    await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  } finally {
    /**
     * ⚠️ In a `finally`, so a bucket that can write but not read does not also
     * get left with litter. The probe is allowed to fail; it is not allowed to
     * leave something behind.
     */
    await client
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
      .catch(() => {});
  }

  return key;
};

/**
 * @returns {Promise<{ ok: boolean, reason?: string, warnings: string[] }>}
 */
exports.checkS3Ready = async () => {
  const warnings = [];

  /**
   * ⚠️ A warning, not a refusal.
   *
   * Without CloudFront, S3 still works — uploads, deletes and delivery all
   * succeed. What is missing is the **resize step**, so a 4 MB original goes to
   * a phone instead of a 40 KB thumbnail. That is a bad day, not a broken
   * platform, and blocking the switch would stop the very testing that has to
   * happen before CloudFront is worth setting up.
   */
  if (!config.CDN_BASE_URL) {
    warnings.push(
      "CloudFront is not configured (CDN_BASE_URL is empty), so images will be " +
        "served at their original size. Uploads and deletes work either way.",
    );
  }

  let client;
  try {
    client = getS3Client();
  } catch (error) {
    return {
      ok: false,
      reason: `S3 client could not be built: ${error.message}`,
      warnings,
    };
  }

  for (const bucket of BUCKETS) {
    const name = bucketName(bucket);
    if (!name) {
      return {
        ok: false,
        reason: `No bucket is configured for ${bucket}. Set S3_BUCKET_${bucket} and redeploy.`,
        warnings,
      };
    }

    try {
      await probeBucket(client, name);
    } catch (error) {
      /**
       * The message matters more than usual here: the admin reading it cannot
       * see a log, and the difference between "wrong key" and "policy missing"
       * is the difference between two very different fixes.
       */
      return {
        ok: false,
        reason:
          `Could not write, read and delete a test object in "${name}" ` +
          `(${error.name || "error"}: ${error.message}). ` +
          `Check the access key, and that its policy grants PutObject, ` +
          `GetObject and DeleteObject on this bucket.`,
        warnings,
      };
    }
  }

  return { ok: true, warnings };
};

/** Which providers have to prove themselves before they may be selected. */
exports.PROVIDERS_NEEDING_PREFLIGHT = Object.freeze([STORAGE_PROVIDER.AWS_S3]);
