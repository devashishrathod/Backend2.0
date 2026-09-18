const { createPresignedPost } = require("@aws-sdk/s3-presigned-post");

const Upload = require("../../models/Upload");
const { getS3Client, bucketName } = require("../../configs/s3");
const {
  UPLOAD_PURPOSES,
  MEDIA_KIND,
  MEDIA_KIND_PREFIX,
  kindFromMime,
} = require("../../constants/storage");
const { buildStagingKey } = require("./keys");
const { throwError } = require("../../utils");

/**
 * Hand the client permission to write exactly one object, and nothing else.
 *
 * ### 🔴 Why POST and not PUT
 *
 * A presigned **PUT** signs a URL. Whoever holds it can send any number of
 * bytes with any content type — the signature covers the destination, not the
 * request. So the 100 MB ceiling, which exists so that nothing from any client
 * can fill this disk, would simply not apply to the one upload path that
 * bypasses the server.
 *
 * A presigned **POST** signs a *policy*, and S3 enforces it before it writes:
 *
 *     content-length-range   the size cap, checked by S3, not by us
 *     starts-with $key       the caller cannot choose where the file lands
 *     starts-with $Content-Type  narrowed to the surface's allow-list
 *
 * That is the difference between a limit and a request.
 *
 * ### ⚠️ Everything the client sends here is still a claim
 *
 * `contentType` and `sizeBytes` decide the policy, and the policy is what S3
 * enforces — but neither is evidence about the bytes. A file announced as
 * `image/png` is checked against its own first bytes at confirm, and that is
 * where a file gets to be what it says it is.
 */

/** How long the client has to start the upload. */
const PRESIGN_TTL_SECONDS = 15 * 60;

/**
 * How long the intent row survives if nothing is confirmed.
 *
 * Longer than the signature, because a slow upload that finishes at minute
 * fourteen still has to be confirmable — the row must outlive the window, not
 * match it.
 */
const INTENT_TTL_MS = 60 * 60 * 1000;

exports.PRESIGN_TTL_SECONDS = PRESIGN_TTL_SECONDS;

/**
 * @param {{ userId: string }} actor
 * @param {{ purpose, contentType, sizeBytes, fileName }} payload
 */
exports.createUploadIntent = async (actor, payload) => {
  const { purpose, contentType, sizeBytes, fileName } = payload;

  const entry = UPLOAD_PURPOSES[purpose];
  if (!entry) throwError(422, `Unknown upload purpose: ${purpose}`);

  /**
   * ⚠️ The declared type is checked against the surface **now**, so a caller
   * cannot be handed a signature for something the surface would never accept.
   * It is a cheap refusal, not the real check — see the note above.
   */
  const kind = kindFromMime(contentType);
  if (!kind || !entry.kinds.includes(kind)) {
    throwError(
      422,
      `${purpose} does not accept ${contentType || "files with no content type"}.`,
    );
  }

  const maxBytes = entry.maxBytes;
  if (maxBytes && sizeBytes > maxBytes) {
    throwError(
      413,
      `That file is ${Math.ceil(sizeBytes / 1024 / 1024)} MB. The limit here is ` +
        `${Math.floor(maxBytes / 1024 / 1024)} MB.`,
    );
  }

  const stagingKey = buildStagingKey({
    userId: actor.userId,
    mime: contentType,
    originalName: fileName,
  });

  const { url, fields } = await createPresignedPost(getS3Client(), {
    Bucket: bucketName(entry.bucket),
    Key: stagingKey,
    Expires: PRESIGN_TTL_SECONDS,
    Conditions: [
      // Exactly this key. `starts-with` on the full key leaves no room to move.
      ["eq", "$key", stagingKey],
      /**
       * ⚠️ Zero as the floor, not one. An empty file is a real outcome of a
       * cancelled upload, and letting S3 reject it here means confirm never has
       * to reason about a zero-byte object.
       */
      ["content-length-range", 1, maxBytes],
      /**
       * ⚠️ `eq`, not `starts-with`. The client already told us what it is
       * sending and that was checked against the surface — so pin it. A
       * `starts-with` on an empty string is not a condition at all, and one on
       * `"image/"` would let a declared `image/png` arrive as `image/svg+xml`.
       *
       * This still only pins the **header**. What the bytes are is settled at
       * confirm, and the stored type is taken from them.
       */
      ["eq", "$Content-Type", contentType],
    ],
    Fields: { "Content-Type": contentType },
  });

  const intent = await Upload.create({
    userId: actor.userId,
    purpose,
    stagingKey,
    declaredContentType: contentType,
    declaredSizeBytes: sizeBytes,
    expiresAt: new Date(Date.now() + INTENT_TTL_MS),
  });

  return {
    uploadId: intent._id,
    /**
     * The client POSTs a multipart form to `url` with every field in `fields`
     * **first** and the file **last** — S3 ignores anything after the file part,
     * so a field sent after it is a field that was never applied.
     */
    url,
    fields,
    expiresInSeconds: PRESIGN_TTL_SECONDS,
    // What the object will be called once confirmed, so a client that wants to
    // show progress has something stable to key on.
    stagingKey,
    typePrefix: MEDIA_KIND_PREFIX[kind],
  };
};
