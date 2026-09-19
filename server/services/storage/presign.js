const { createPresignedPost } = require("@aws-sdk/s3-presigned-post");

const Upload = require("../../models/Upload");
const { getS3Client, bucketName } = require("../../configs/s3");
const {
  UPLOAD_PURPOSES,
  MEDIA_KIND_PREFIX,
  STORAGE_PROVIDER,
  kindFromMime,
} = require("../../constants/storage");
const { buildStagingKey } = require("./keys");
const { refusalForMime } = require("./inspect");
const { getUploadLimit, getStorageConfig } = require("../../helpers/settings");
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

/**
 * @param {{ userId: string }} actor
 * @param {{ purpose, contentType, sizeBytes, fileName }} payload
 */
exports.createUploadIntent = async (actor, payload) => {
  const { purpose, contentType, sizeBytes, fileName } = payload;

  /**
   * 🔴 All three used to be constants in this file while the admin panel showed
   * fields — `presignEnabled`, `presignTtlMinutes`, `intentTtlMinutes` — that
   * changed nothing at all. `getStorageConfig` had already converted them into
   * the units wanted here, and nothing read the result: a knob with a schema, a
   * validator, a doc entry and no reader is worse than an absent one, because
   * everybody downstream believes it works.
   *
   * ### ⚠️ `confirm` deliberately does **not** read `presignEnabled`
   *
   * Turning presigning off while vendors hold valid signatures must not strand
   * their uploads: those files are already in the bucket and already paid for,
   * and refusing them would leave objects with no row and vendors with no
   * explanation. The switch closes the door; it does not trap whoever is already
   * inside.
   *
   * ⚠️ Default `false` — nothing is live on this road yet, and a capability that
   * has to be turned **on** is cheaper to get wrong than one that has to be
   * turned off. That stops being true the day X-4 removes the multipart road,
   * because then this switch stops being survivable; revisit it there.
   *
   * ⚠️ The intent TTL is kept **longer** than the signature by
   * `assertStorageLimitRule`, not trusted here — an upload that starts at minute
   * fourteen still has to be confirmable, so the row must outlive the window
   * rather than match it.
   */
  const { presignEnabled, presignTtlSeconds, intentTtlMs, provider } =
    await getStorageConfig();

  if (!presignEnabled) {
    throwError(
      503,
      "Presigned upload is turned off for this platform. Turn it on in " +
        "Admin → Settings → Storage, or send the file directly as a multipart " +
        "field on the same request.",
    );
  }

  /**
   * 🔴 On, but pointing at the wrong provider.
   *
   * This road writes to S3 unconditionally — it is built on
   * `@aws-sdk/s3-presigned-post` and there is no Cloudinary equivalent. So if
   * the platform is on Cloudinary and this is left on, the **same surface**
   * stores some rows on S3 and some on Cloudinary depending on which road the
   * client happened to take, and nothing anywhere says so. Deletes would still
   * work (they follow the row), but every other assumption about where media
   * lives quietly stops holding.
   *
   * ⚠️ The message names both fixes, because either is legitimate: this is what
   * a half-finished migration looks like from the admin panel, and the person
   * reading it cannot see which half they are in.
   */
  if (provider !== STORAGE_PROVIDER.AWS_S3) {
    throwError(
      409,
      `Presigned upload only works on S3, and this platform is set to ` +
        `${provider}. Either switch Admin → Settings → Storage → provider to ` +
        `AWS_S3, or turn presigned upload off so every file takes the same road.`,
    );
  }

  const entry = UPLOAD_PURPOSES[purpose];
  if (!entry) throwError(422, `Unknown upload purpose: ${purpose}`);

  /**
   * 🔴 Types this platform refuses outright, refused **before** the upload.
   *
   * `confirm` catches these from the bytes, which is the check that actually
   * holds — but it runs after the client has uploaded the whole file. A caller
   * who honestly declares `image/heic` should not be handed a signature, spend
   * a 4 MB photo over mobile data, and only then be told no.
   *
   * ⚠️ The words come from the same list `identify` refuses by, so both roads
   * say it identically — and `kindFromMime` cannot help here: it answers
   * `IMAGE` for `image/heic` and `image/svg+xml` alike, because its job is to
   * **name** a file so a surface can refuse it, not to decide policy.
   */
  const declaredRefusal = refusalForMime(contentType);
  if (declaredRefusal) throwError(400, declaredRefusal.reason);

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

  /**
   * 🔴 The admin's number, not the constant.
   *
   * This used to be `entry.maxBytes` — a static per-surface ceiling in code. So
   * `Setting.storage.limits` (ST-3) and every surface override (ST-4) applied to
   * the multipart road and to nothing else: an admin lowering the platform video
   * limit from 50 MB to 20 changed the panel and left this road at 50.
   *
   * ⚠️ It also goes into the **policy** below, which is the part that matters.
   * This 413 is only the readable refusal; `content-length-range` is what S3
   * enforces, and enforcing the old constant there meant the real limit was the
   * one nobody could change.
   */
  const { maxBytes, maxSizeMB } = await getUploadLimit(purpose, kind);
  if (sizeBytes > maxBytes) {
    throwError(
      413,
      `That file is ${Math.ceil(sizeBytes / 1024 / 1024)} MB. The limit here is ` +
        `${maxSizeMB} MB.`,
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
    Expires: presignTtlSeconds,
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
    declaredFileName: fileName,
    expiresAt: new Date(Date.now() + intentTtlMs),
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
    expiresInSeconds: presignTtlSeconds,
    // What the object will be called once confirmed, so a client that wants to
    // show progress has something stable to key on.
    stagingKey,
    typePrefix: MEDIA_KIND_PREFIX[kind],
  };
};
