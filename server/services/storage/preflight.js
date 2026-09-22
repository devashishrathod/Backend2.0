const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const { getS3Client, bucketName } = require("../../configs/s3");
const { STORAGE_BUCKET, STORAGE_PROVIDER } = require("../../constants/storage");
const { prefix, stagingPrefix } = require("./keys");
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
  /**
   * ⚠️ `stagingPrefix()`, not a second copy of the string.
   *
   * This probe is litter that the lifecycle rule has to be able to reach, and
   * the rule keys on exactly one prefix. Spelling it here as well is how the two
   * drift until the probe lands somewhere nothing sweeps — which is what
   * happened when this read `${prefix()}staging/` and the rule was written for
   * `staging/`.
   */
  const key = `${stagingPrefix()}__preflight_${Date.now()}_${Math.random()
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
 * 🔴 Can a **customer** read it? — the question the probe above cannot answer.
 *
 * ### Why writing and reading with credentials proves nothing about delivery
 *
 * `probeBucket` uses `getS3Client()`, so every request it makes is signed. A
 * bucket with Block Public Access on — the AWS default — passes it completely
 * and then answers `403 AccessDenied` to every `<img src>` on the platform.
 * Measured on `trydood-nonprod-public`: preflight green, delivery dead.
 *
 * ### ⚠️ The URL under test is the one the app will actually write
 *
 * `providers/s3.js` uses `CDN_BASE_URL` when it is set and a raw S3 URL when it
 * is not, and that string is **stored on the row** at upload time. So exactly
 * one of them matters, and which one is not a judgement call:
 *
 *   - `CDN_BASE_URL` set   → that host must serve the object. The bucket being
 *                            closed is then correct, not a problem: CloudFront
 *                            with OAC reads it with its own identity.
 *   - `CDN_BASE_URL` empty → the raw S3 URL must serve it, which means public
 *                            read has to be on.
 *
 * ### ⚠️ Not under `staging/`
 *
 * The distribution is meant to **deny** `staging/*`, so probing a staging key
 * would fail on a correctly configured CloudFront. This writes under the type
 * tree, where real media lives, and removes it on the way out.
 */
const DELIVERY_TIMEOUT_MS = 8000;

const probeDelivery = async (client, bucket) => {
  const key = `${prefix()}images/__preflight/${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}.txt`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: "trydood delivery preflight",
      ContentType: "text/plain",
      CacheControl: "no-store",
    }),
  );

  const base = config.CDN_BASE_URL
    ? config.CDN_BASE_URL.replace(/\/+$/, "")
    : `https://${bucket}.s3.${config.AWS_REGION}.amazonaws.com`;

  try {
    /**
     * ⚠️ No credentials, deliberately — `fetch`, not the SDK. The SDK would sign
     * the request and answer the question we already know the answer to.
     */
    const response = await fetch(`${base}/${key}`, {
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    return response.ok
      ? { ok: true }
      : { ok: false, detail: `${response.status} ${response.statusText}` };
  } catch (error) {
    // ENOTFOUND is the interesting one: a `CDN_BASE_URL` pointing at a host that
    // does not exist yet, which is what a half-finished CloudFront looks like.
    return {
      ok: false,
      detail: error.cause?.code || error.name || error.message,
    };
  } finally {
    await client
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
      .catch(() => {});
  }
};

/**
 * @returns {Promise<{ ok: boolean, reason?: string, warnings: string[] }>}
 */
exports.checkS3Ready = async () => {
  const warnings = [];

  /**
   * ⚠️ A warning, not a refusal — but only because delivery is proven below.
   *
   * Without CloudFront, S3 still works: uploads, deletes and delivery all
   * succeed **provided the bucket is publicly readable**, which `probeDelivery`
   * now establishes rather than assumes. What is missing is the resize step, so
   * a 4 MB original goes to a phone instead of a 40 KB thumbnail. That is a bad
   * day, not a broken platform.
   *
   * 🔴 The old check asked only whether `CDN_BASE_URL` was **empty**. A value
   * that is set and dead therefore produced no warning at all — the quietest
   * possible version of the worst outcome.
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

  /**
   * 🔴 Delivery, last — and it **refuses**, it does not warn.
   *
   * A warning here would be read past. The failure it describes is every image,
   * video and GIF on the platform answering 403 or not resolving at all, from
   * the moment the dropdown is saved, with nothing in any log to connect the two
   * — the code is working correctly on both sides of a URL that goes nowhere.
   *
   * ⚠️ Only the public bucket. The private one is *supposed* to refuse an
   * anonymous reader; documents are served through a presigned GET minted per
   * request, so there is nothing about it that a browser should be able to open.
   */
  const publicBucket = bucketName(STORAGE_BUCKET.PUBLIC);
  const delivery = await probeDelivery(client, publicBucket).catch((error) => ({
    ok: false,
    detail: error.message,
  }));

  if (!delivery.ok) {
    return {
      ok: false,
      reason: config.CDN_BASE_URL
        ? `Uploads work, but nothing can read them back. "${config.CDN_BASE_URL}" ` +
          `did not serve a freshly written object (${delivery.detail}). Every image ` +
          `URL this platform stores is built from that host, so switching now would ` +
          `save rows pointing at a URL that does not answer. Check that the ` +
          `CloudFront distribution exists, that its origin is "${publicBucket}", and ` +
          `that the DNS record for that host points at it — or clear CDN_BASE_URL ` +
          `and open public read on the bucket instead.`
        : `Uploads work, but nothing can read them back. "${publicBucket}" answered ` +
          `${delivery.detail} to a request with no credentials, which is what every ` +
          `customer's browser sends. Either allow public s3:GetObject on this bucket, ` +
          `or put CloudFront in front of it and set CDN_BASE_URL.`,
      warnings,
    };
  }

  return { ok: true, warnings };
};

/** Which providers have to prove themselves before they may be selected. */
exports.PROVIDERS_NEEDING_PREFLIGHT = Object.freeze([STORAGE_PROVIDER.AWS_S3]);
