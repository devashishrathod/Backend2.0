const Upload = require("../../models/Upload");
const { throwError } = require("../../utils");
const {
  UPLOAD_PURPOSES,
  STORAGE_BUCKET,
} = require("../../constants/storage");

/**
 * One door, two ways in (U-1).
 *
 * ### 🔴 Why a facade rather than an `if` in every surface
 *
 * There are nineteen call sites that take a file, and the move to presigned
 * upload does not happen everywhere on the same day. Without this, each of them
 * grows its own branch — and nineteen branches is nineteen chances to check the
 * purpose in one and forget it in the next, or to translate confirm's fields
 * slightly differently, or to let a caller send both a file and an uploadId and
 * silently pick one.
 *
 * A surface asks for *a file*, names its purpose, and gets back the same shape
 * either way. Which road it came down is this file's business.
 *
 * ### ⚠️ `require("./index")` is inside the functions, on purpose
 *
 * The barrel re-exports this file, so a top-level require here would be a
 * cycle — and `uploadFromPath` and `publicUrl` live in the barrel itself, not
 * in a module of their own. Deferring the lookup to call time is the smaller
 * price than moving two functions to break a loop nobody else feels.
 *
 * ### ⚠️ The two shapes are genuinely different, and that is the point
 *
 * `uploadFromPath` answers `{ url, storage, metadata: { mimeType, size, … } }`.
 * `confirmUpload` answers `{ storage, metadata: { contentType, sizeBytes, … } }`
 * — different names, and no `url` at all, because the verified metadata is
 * built from the bytes rather than from what a provider returned.
 *
 * Every surface then hands the result to `toMediaDocument`, which reads
 * `mimeType` and `size`. So the translation has to happen somewhere, and doing
 * it here means it happens once.
 */

/** What `toMediaDocument` expects, built from what `confirmUpload` returns. */
const asUploadResult = ({ storage: stored, metadata }, { purpose, url }) => ({
  /**
   * ⚠️ `null` for a private object, which is the honest answer rather than a
   * missing one — a document's link is minted per request and must not be
   * stored. `toMediaDocument` already treats a key as locatable, so nothing
   * downstream needs to care.
   */
  url: url ?? null,
  storage: stored,
  metadata: {
    mimeType: metadata.contentType ?? null,
    size: metadata.sizeBytes ?? 0,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    duration: metadata.duration ?? 0,
    // The uploader's own file name never reaches S3 — the key is a uuid — so
    // there is nothing honest to put here on this road.
    originalName: null,
  },
  purpose,
});

/**
 * Take one file, however it arrived.
 *
 * @param {{ userId: string }} actor
 * @param {object}  options
 * @param {object}  [options.file]      a multipart file, the old road
 * @param {string}  [options.uploadId]  a confirmed presign, the new one
 * @param {string}  options.purpose     what this surface is for
 * @param {string|object} [options.entityId]
 * @param {string}  [options.label]     for the message when nothing arrives
 * @param {boolean} [options.required]
 * @returns {Promise<object|null>} an `uploadFromPath`-shaped result, or `null`
 */
exports.acceptUpload = async (actor, options = {}) => {
  const {
    file,
    uploadId,
    purpose,
    entityId = null,
    label = "A file",
    required = false,
  } = options;

  const entry = UPLOAD_PURPOSES[purpose];
  if (!entry) throwError(500, `Unknown upload purpose: ${purpose}`);

  /**
   * 🔴 E1 — both roads at once is a refusal, not a preference.
   *
   * Picking one silently means the caller believes they sent the other. A panel
   * that presigned a new logo and also attached the old file would see whichever
   * this function happened to prefer, and would have no way to tell which.
   */
  if (file && uploadId) {
    throwError(
      422,
      "Send either a file or an uploadId, not both — they are two ways to do the same thing.",
    );
  }

  if (!file && !uploadId) {
    if (required) throwError(422, `${label} is required.`);
    return null;
  }

  if (uploadId) return fromIntent(actor, { uploadId, purpose, entityId, entry });

  // The old road. Unchanged, and it stays until U-5 retires it.
  const { uploadFromPath } = require("./index");
  return uploadFromPath({
    filePath: file.tempFilePath,
    originalFile: file,
    purpose,
    entityId,
  });
};

/**
 * Take a list of files, however they arrived.
 *
 * ⚠️ Mixed is allowed — three presigned uploads and one multipart file in the
 * same request is fine, because during the migration a client may well have
 * both. What is refused is one *item* claiming to be both, which is the case
 * that means somebody lost track of what they sent.
 *
 * @param {{ userId: string }} actor
 * @param {object} options
 * @param {Array}  [options.files]      multipart files
 * @param {Array}  [options.uploadIds]  confirmed presigns
 */
exports.acceptUploads = async (actor, options = {}) => {
  const { files = [], uploadIds = [], purpose, entityId = null } = options;

  const list = Array.isArray(files) ? files : [files].filter(Boolean);
  const ids = Array.isArray(uploadIds) ? uploadIds : [uploadIds].filter(Boolean);

  /**
   * ⚠️ Sequentially, not `Promise.all`. Each confirm copies an object inside S3
   * and writes a row; running a whole gallery of them at once turns one vendor's
   * save into a burst this service has no reason to make.
   */
  const results = [];
  for (const file of list) {
    results.push(await exports.acceptUpload(actor, { file, purpose, entityId }));
  }
  for (const uploadId of ids) {
    results.push(
      await exports.acceptUpload(actor, { uploadId, purpose, entityId }),
    );
  }
  return results.filter(Boolean);
};

/**
 * The presigned road.
 *
 * 🔴 E2 — the purpose is checked **before** the upload is consumed.
 *
 * A caller who presigned a category image and then sent that id to the brand
 * logo endpoint is refused, and their upload is still theirs to use on the right
 * surface. Checking after confirm would burn it: the intent would be marked
 * consumed, the object already moved, and the client would have to upload the
 * whole file again to fix a one-word mistake.
 */
const fromIntent = async (actor, { uploadId, purpose, entityId, entry }) => {
  const intent = await Upload.findOne({
    _id: uploadId,
    userId: actor.userId,
  })
    .select("purpose consumedAt")
    .lean();

  /**
   * ⚠️ 404 rather than 403, and by id **and** owner together — the same rule
   * confirm uses. Telling somebody their id is real but not theirs tells them
   * it is real.
   */
  if (!intent) throwError(404, "That upload was not found.");

  if (intent.purpose !== purpose) {
    throwError(
      422,
      `That upload was authorised for ${intent.purpose}, and this is ${purpose}. ` +
        "Upload it again for this one.",
    );
  }

  const { confirmUpload, publicUrl } = require("./index");
  const confirmed = await confirmUpload(actor, uploadId, { entityId });

  /**
   * ⚠️ No URL for a private object. `publicUrl` refuses to build one — by
   * design, because a stored link would outlive the permission behind it.
   */
  const url =
    entry.bucket === STORAGE_BUCKET.PRIVATE
      ? null
      : publicUrl({ storage: confirmed.storage });

  return asUploadResult(confirmed, { purpose, url });
};
