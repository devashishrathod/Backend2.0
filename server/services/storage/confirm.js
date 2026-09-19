const crypto = require("crypto");

const {
  HeadObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const Upload = require("../../models/Upload");
const { getS3Client, bucketName } = require("../../configs/s3");
const {
  UPLOAD_PURPOSES,
  STORAGE_PROVIDER,
  MEDIA_KIND_PREFIX,
} = require("../../constants/storage");
const { identify, readDimensions, HEAD_BYTES } = require("./inspect");
const { prefix } = require("./keys");
const { getUploadLimit } = require("../../helpers/settings");
const { throwError } = require("../../utils");

/**
 * Turn an uploaded object into one this app will actually serve.
 *
 * ### 🔴 The file arrives before anybody has looked at it
 *
 * A presigned POST means the bytes go straight from the client to S3. The
 * server's first sight of them is here — so this is where a file stops being a
 * claim and becomes a known thing, and it is the only place that can decide it.
 *
 * Everything the client said is treated as a request:
 *
 *     what it said it was    →  checked against its first bytes
 *     where it said to put it →  it did not; the key comes from the purpose
 *     what it said it was for →  read from the intent row, not the request
 *
 * ### Why it lands in `staging/` first
 *
 * A key like `images/brands/…` is a **claim about content**, and at upload time
 * the only evidence for it is a header. So the object is written outside the
 * type tree and only moves under its real prefix once its bytes have been read.
 * Anything that never gets that far is removed by the bucket's own lifecycle
 * rule — no cron, no sweep job.
 */

const readHead = async (client, bucket, key) => {
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${HEAD_BYTES - 1}` }),
  );

  const chunks = [];
  for await (const chunk of result.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
};

/** Remove a rejected upload rather than leave it for the lifecycle rule. */
const discard = async (client, bucket, key) => {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    // The lifecycle rule on `staging/` is the backstop, so this is a log line.
    console.error("Could not discard a rejected upload:", error.message);
  }
};

/**
 * @param {{ userId: string }} actor
 * @param {string} uploadId
 * @param {{ entityId?: string }} options  where the file will live
 */
exports.confirmUpload = async (actor, uploadId, { entityId } = {}) => {
  /**
   * ⚠️ Found by id **and** owner together, so a valid id belonging to somebody
   * else never loads. A signed permission is not transferable, and an id in a
   * request body is a claim rather than proof.
   */
  const intent = await Upload.findOne({ _id: uploadId, userId: actor.userId });
  if (!intent) throwError(404, "That upload was not found.");

  /**
   * 🔴 The replay guard. Without it, one uploaded object could be confirmed
   * twice and attached to two different rows — the second of which would then
   * hold a file it never paid for and cannot be told apart from a legitimate
   * one.
   */
  if (intent.consumedAt) {
    throwError(409, "That upload has already been used.");
  }

  const entry = UPLOAD_PURPOSES[intent.purpose];
  const bucket = bucketName(entry.bucket);
  const client = getS3Client();

  // Did the client actually send anything?
  let head;
  try {
    head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: intent.stagingKey }),
    );
  } catch {
    throwError(400, "That file was never uploaded, or has already expired.");
  }

  /**
   * ---------------- what the bytes actually are ----------------
   *
   * 🔴 The one check the caller does not get to write. Every other test in the
   * upload path reads a `Content-Type` the client chose.
   */
  const firstBytes = await readHead(client, bucket, intent.stagingKey);
  const identified = identify(firstBytes);

  if (!identified) {
    await discard(client, bucket, intent.stagingKey);
    throwError(400, "That file type is not supported.");
  }
  if (identified.refused) {
    await discard(client, bucket, intent.stagingKey);
    throwError(400, identified.reason);
  }

  /**
   * ⚠️ Checked against the **purpose**, not against what was declared. A caller
   * who presigned an avatar and uploaded a video is refused here even though
   * both steps looked individually fine.
   */
  if (!entry.kinds.includes(identified.kind)) {
    await discard(client, bucket, intent.stagingKey);
    throwError(
      422,
      `${intent.purpose} does not accept ${identified.name} files.`,
    );
  }

  /**
   * 🔴 How big it **really** is, against the limit as it stands **now**.
   *
   * Nothing checked this before. The presign policy's `content-length-range` was
   * the only size enforcement on this road, and a policy is written once, at
   * presign time — so two things slipped past it:
   *
   * - the policy carried the **static** ceiling, not the admin's (fixed in
   *   `presign`, but every signature issued before that is still valid for its
   *   full fifteen minutes)
   * - an admin can lower the limit **between** the presign and the confirm, and
   *   the signature in the client's hand does not change when they do
   *
   * ⚠️ Checked per **verified** kind, not per declared one. A 40 MB file
   * announced as a GIF and actually a video is metered as a video — which is the
   * whole reason the kind is settled from the bytes a few lines above.
   *
   * The object is discarded, exactly as a refused type is. Leaving it would mean
   * a caller could park oversize objects in `staging/` at will, one failed
   * confirm at a time.
   */
  const { maxBytes, maxSizeMB } = await getUploadLimit(
    intent.purpose,
    identified.kind,
  );
  if (head.ContentLength > maxBytes) {
    await discard(client, bucket, intent.stagingKey);
    throwError(
      413,
      `That file is ${Math.ceil(head.ContentLength / 1024 / 1024)} MB. ` +
        `The limit here is ${maxSizeMB} MB.`,
    );
  }

  const dimensions = readDimensions(firstBytes, identified.name) || {
    width: null,
    height: null,
  };

  /**
   * ---------------- where it really belongs ----------------
   *
   * The prefix comes from the **verified** kind, so a GIF that announced itself
   * as a PNG still lands in `gifs/` — clear of the resize Lambda that would
   * flatten it.
   */
  const extension = identified.mime.split("/")[1].replace("+xml", "");
  const finalKey =
    `${prefix()}${MEDIA_KIND_PREFIX[identified.kind]}/${entry.entity}/` +
    `${entityId ? `${String(entityId).replace(/[^a-zA-Z0-9_-]/g, "")}/` : ""}` +
    `${crypto.randomUUID()}.${extension}`;

  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: finalKey,
      CopySource: encodeURIComponent(`${bucket}/${intent.stagingKey}`),
      ContentType: identified.mime,
      /**
       * 🔴 `REPLACE`, and it is load-bearing. Without it S3 carries the source
       * object's metadata across — which is the `Content-Type` the **client**
       * set. An MP4 announced as `image/jpeg` would then be served as
       * `image/jpeg` from the CDN, cached that way for as long as the object
       * lives, and render as a broken image with nothing in any log to say why.
       */
      MetadataDirective: "REPLACE",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  const storage = {
    provider: STORAGE_PROVIDER.AWS_S3,
    publicId: null,
    bucket,
    key: finalKey,
  };

  const verified = {
    contentType: identified.mime,
    kind: identified.kind,
    sizeBytes: head.ContentLength,
    ...dimensions,
  };

  /**
   * ⚠️ Conditional on `consumedAt` still being null, so two confirms racing each
   * other cannot both win. The loser is told the upload is already used rather
   * than quietly getting a second copy.
   */
  const claimed = await Upload.findOneAndUpdate(
    { _id: intent._id, consumedAt: null },
    { $set: { consumedAt: new Date(), storage, verified } },
    { new: true },
  );
  if (!claimed) throwError(409, "That upload has already been used.");

  // Best effort: the lifecycle rule removes whatever this misses.
  await discard(client, bucket, intent.stagingKey);

  return { storage, metadata: verified };
};
