const Upload = require("../../models/Upload");
const { throwError } = require("../../utils");
const {
  UPLOAD_PURPOSES,
  STORAGE_BUCKET,
} = require("../../constants/storage");
const { inspectLocalFile } = require("./inspect");
const { getUploadLimit } = require("../../helpers/settings");

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

/**
 * ⚠️ A surface that reached the presigned road without an actor is **our**
 * bug, not the caller's — and the honest answer matters, because the
 * alternative is quiet and wrong: `findOne({ _id, userId: undefined })` matches
 * nothing and answers `404 That upload was not found`. The vendor is then told
 * their upload expired, every time, for a mistake in a service signature.
 */
const assertActor = (actor) => {
  if (!actor?.userId) {
    throwError(500, "This upload has no actor — the surface did not pass one.");
  }
};

/** What `toMediaDocument` expects, built from what `confirmUpload` returns. */
const asUploadResult = (
  { storage: stored, metadata },
  { purpose, url, originalName },
) => ({
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
    /**
     * ⚠️ The name the uploader's machine gave it, which is **not** where the
     * object lives — the key is a uuid on purpose, so a public URL never carries
     * whatever somebody happened to call the file.
     *
     * It is here because surfaces use it as a default title. Showcase names each
     * gallery item after its file, so returning `null` meant every media added
     * through the presigned road arrived untitled while the multipart road
     * filled it in — the same request, two results, depending on a road the
     * vendor never chose.
     */
    originalName: originalName ?? null,
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

  if (uploadId) {
    assertActor(actor);
    return fromIntent(actor, { uploadId, purpose, entityId, entry });
  }

  /**
   * The multipart road — and it is **not** going away with U-5.
   *
   * ⚠️ The plan once said U-5 would delete it. That was wrong: `presign` is
   * built on `@aws-sdk/s3-presigned-post` and Cloudinary has nothing of that
   * shape, so this is Cloudinary's **only** upload road — and
   * `Setting.storage.provider` is a dropdown that can move back tomorrow.
   * Removing it would leave a switch that promises to keep everything working
   * and silently ends uploads instead.
   *
   * Its sunset is X-4, and X-4's trigger is Cloudinary's own presign, not a
   * date.
   */
  const verified = await verifyLocalFile(file, { purpose, entry });

  const { uploadFromPath } = require("./index");
  const uploaded = await uploadFromPath({
    filePath: file.tempFilePath,
    originalFile: file,
    purpose,
    entityId,
    kind: verified.identified.kind,
  });

  return withVerifiedFacts(uploaded, verified);
};

/**
 * 🔴 The check this road never had.
 *
 * Everything the multipart path knew about a file came from the client: the
 * mime type from a header it wrote, and no size check at all beyond the 100 MB
 * transport limit that exists so one request cannot fill the disk. The
 * presigned road settled both from the object itself, in `confirm`.
 *
 * So one file, sent two ways, got two answers — and the road was chosen by the
 * client, not by any rule of ours. An 8 MB avatar uploaded fine through the
 * panel and returned `413` through presign; an MP4 renamed `.png` was stored
 * and served as `image/png` on one road and refused on the other.
 *
 * ⚠️ The sentences below are **word for word** what `confirm` says. Two
 * wordings for one refusal is how a support queue learns to treat the same
 * problem as two.
 *
 * @returns {{ identified, dimensions }}
 */
const verifyLocalFile = async (file, { purpose, entry }) => {
  const { identified, dimensions } = inspectLocalFile(file.tempFilePath);

  if (!identified) throwError(400, "That file type is not supported.");
  if (identified.refused) throwError(400, identified.reason);

  /**
   * ⚠️ Against the **purpose**, not against what the client declared — the same
   * rule `confirm` applies. A surface's own mime list still runs before this and
   * is usually narrower; this is the floor nobody can skip.
   */
  if (!entry.kinds.includes(identified.kind)) {
    throwError(422, `${purpose} does not accept ${identified.name} files.`);
  }

  /**
   * ⚠️ Metered by the **verified** kind. A 40 MB file announced as a GIF and
   * actually a video is weighed as a video, which is the whole point of
   * settling the kind from the bytes first.
   *
   * `file.size` is counted by `express-fileupload` as it writes the temp file,
   * so unlike the mime type it is not a claim.
   */
  const { maxBytes, maxSizeMB } = await getUploadLimit(purpose, identified.kind);
  if (file.size > maxBytes) {
    throwError(
      413,
      `That file is ${Math.ceil(file.size / 1024 / 1024)} MB. ` +
        `The limit here is ${maxSizeMB} MB.`,
    );
  }

  return { identified, dimensions };
};

/**
 * Replace what the client claimed with what the bytes say.
 *
 * ⚠️ `mimeType` is overwritten unconditionally — both providers report the
 * header they were handed, and it is the one field in the result that the
 * uploader controls. `kind` is decided from it downstream (`toMediaDocument`),
 * and a wrong kind picks the wrong prefix: a GIF stored as `image/png` lands in
 * `images/` rather than `gifs/`, where the resize step of X-1 will flatten its
 * animation and nothing will ever say why.
 *
 * ⚠️ Dimensions only **fill a gap**. Cloudinary returns real ones from its own
 * response; S3 returns `null` because nothing there reads the bytes. Overwriting
 * Cloudinary's with ours would replace a measurement with a header parse for no
 * gain.
 */
const withVerifiedFacts = (uploaded, { identified, dimensions }) => {
  if (!uploaded) return uploaded;

  const metadata = uploaded.metadata || {};
  return {
    ...uploaded,
    metadata: {
      ...metadata,
      mimeType: identified.mime,
      width: metadata.width ?? dimensions?.width ?? null,
      height: metadata.height ?? dimensions?.height ?? null,
    },
  };
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
    .select("purpose consumedAt attachedAt storage verified declaredFileName")
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

  /**
   * 🔴 The client may have confirmed it already, and that is not a mistake.
   *
   * `POST /uploads/confirm` is a live endpoint and every panel doc tells a
   * client to call it before sending the id here — so this branch is the
   * *documented* sequence, not an edge case. It used to walk into
   * `confirmUpload`'s replay guard and come back **409 "That upload has already
   * been used."** about a file uploaded exactly once. Every presigned surface
   * had it; voucher create then wrapped it into a 500.
   *
   * ⚠️ Nothing is re-read and nothing is re-copied. Confirm already settled what
   * the bytes are and moved the object — the answer is on the row, and doing it
   * twice is not possible anyway: confirm deletes the staging object it copied
   * from.
   *
   * ⚠️ `entityId` therefore does not reach the key on this road; the object was
   * placed before the row it belongs to existed. Nothing reads an entity back
   * out of a key — it groups objects for a human browsing the bucket, which is
   * worth losing to keep the client's early refusal.
   */
  const confirmed = intent.consumedAt
    ? fromConfirmedIntent(intent)
    : await confirmUpload(actor, uploadId, { entityId });

  /**
   * 🔴 The one-use claim, and it is deliberately **after** the file is known to
   * be real.
   *
   * Claiming first would burn an upload that never became anything: a refused
   * type or an oversize file would leave the id spent and the vendor re-picking
   * a file the platform had not even accepted. Confirm discards the object in
   * those cases, so nothing is left attached to.
   *
   * ⚠️ Nothing is wasted by claiming late either. Two saves racing on an
   * unconfirmed id are already decided by confirm's own conditional update, so
   * only one of them ever reaches this line; two racing on a confirmed id do no
   * storage work at all.
   */
  await claimForAttachment(intent._id);

  /**
   * ⚠️ No URL for a private object. `publicUrl` refuses to build one — by
   * design, because a stored link would outlive the permission behind it.
   */
  const url =
    entry.bucket === STORAGE_BUCKET.PRIVATE
      ? null
      : publicUrl({ storage: confirmed.storage });

  return asUploadResult(confirmed, {
    purpose,
    url,
    originalName: intent.declaredFileName,
  });
};

/**
 * What `confirmUpload` answered the first time, read back off the row.
 *
 * ⚠️ Both halves are written by one `$set`, so a row carrying one without the
 * other was not written by this build. Saying so is better than the alternative:
 * a missing `verified` would flow into `asUploadResult`'s `??` fallbacks and
 * store a media row with a null mime type and a zero size, which nothing
 * downstream would complain about.
 */
const fromConfirmedIntent = (intent) => {
  if (!intent.storage?.provider || !intent.verified?.contentType) {
    throwError(
      500,
      "That upload was confirmed, but no file was recorded against it.",
    );
  }
  return { storage: intent.storage, metadata: intent.verified };
};

/**
 * Take the upload for this row, or refuse because somebody else already did.
 *
 * ⚠️ Conditional, never read-then-write. Two saves landing together would both
 * see `attachedAt: null` and both proceed, which is the entire failure this
 * guards: one uploaded object on two rows, the second holding a file nobody
 * paid for.
 */
const claimForAttachment = async (uploadId) => {
  const claimed = await Upload.findOneAndUpdate(
    { _id: uploadId, attachedAt: null },
    { $set: { attachedAt: new Date() } },
    // `returnDocument: "after"` rather than `new: true` — the latter is
    // deprecated in Mongoose 9 and warns on every upload a surface takes. Only
    // the match matters here, not which copy of the row comes back.
    { returnDocument: "after" },
  );
  if (!claimed) throwError(409, "That upload has already been used.");
};

/**
 * What is about to arrive — **without** consuming it.
 *
 * ### 🔴 Why a surface needs this
 *
 * A surface's rules are not the platform's. Showcase meters how many photos and
 * videos one section may hold, and which exact mime types it takes — `image/gif`
 * is on its list, `video/quicktime` may not be — and none of that is anything
 * `presign` or `confirm` know about. They check the **kind** family and the
 * size; the counts and the allow-list belong to the surface.
 *
 * On the multipart road the surface simply reads `file.mimetype` and
 * `file.size`. On the presigned road there is no file, only an id — so this
 * answers the same question from the intent row, and the surface's own checks
 * go on working unchanged.
 *
 * ### 🔴 It runs before `confirm`, and that is the point
 *
 * A section that is already full, or a mime the surface does not take, has to be
 * refused while the upload is still spendable. Checking afterwards would burn
 * it: intent consumed, object moved, and a vendor who picked one file too many
 * would have to upload every one of them again.
 *
 * ### ⚠️ Everything here is a claim, and that is enough for what it decides
 *
 * `declaredContentType` and `declaredSizeBytes` are what the client said. They
 * decide a **refusal message** and a count — not where bytes land and not
 * whether they may exist. Size is enforced by the signed policy and re-checked
 * at confirm against the real byte count; type is settled at confirm from the
 * magic bytes. Lying here buys a worse error later, not a wider door.
 *
 * ⚠️ The result carries **either** `file` or `uploadId`, never both — so one
 * object describes an incoming item and also knows how to fetch it. A surface
 * can then keep a single list, in one order, and hand each item straight to
 * `acceptUpload` when the time comes.
 *
 * @returns {Promise<{name, mimetype, size, uploadId, file}|null>} `name`,
 *          `mimetype` and `size` are the three fields a surface already reads
 *          off an `express-fileupload` file
 */
exports.describeIncoming = async (actor, options = {}) => {
  const { file, uploadId, purpose } = options;

  if (!UPLOAD_PURPOSES[purpose]) {
    throwError(500, `Unknown upload purpose: ${purpose}`);
  }

  // The same refusal `acceptUpload` gives, in the same words — one item claiming
  // to be both means somebody lost track of what they sent.
  if (file && uploadId) {
    throwError(
      422,
      "Send either a file or an uploadId, not both — they are two ways to do the same thing.",
    );
  }

  if (file) {
    /**
     * 🔴 The **verified** mime, not the header the client wrote.
     *
     * Every surface rule downstream — `assertImageFile`, the banner and ticker
     * mime lists, `validateVoucherImages` — reads this field. Handing them
     * `file.mimetype` meant all of them were deciding on a value the uploader
     * chose, and `inspect.js` says so at the top of the file.
     *
     * ⚠️ Refusals happen here rather than being reported as a `null` mime,
     * because the specific sentence is the useful one: *"SVG files are not
     * accepted — they can carry scripts"* tells the vendor what to change, and a
     * surface answering *"Logo must be an image"* about a file that **is** an
     * image does not. Same words as `confirm`.
     */
    const { identified } = inspectLocalFile(file.tempFilePath);
    if (!identified) throwError(400, "That file type is not supported.");
    if (identified.refused) throwError(400, identified.reason);

    return {
      name: file.name ?? null,
      mimetype: identified.mime,
      size: file.size ?? 0,
      uploadId: null,
      file,
    };
  }

  if (!uploadId) return null;

  assertActor(actor);

  const intent = await Upload.findOne({ _id: uploadId, userId: actor.userId })
    .select("purpose declaredContentType declaredSizeBytes declaredFileName")
    .lean();

  // 404 rather than 403, and by id **and** owner — see `fromIntent`.
  if (!intent) throwError(404, "That upload was not found.");

  if (intent.purpose !== purpose) {
    throwError(
      422,
      `That upload was authorised for ${intent.purpose}, and this is ${purpose}. ` +
        "Upload it again for this one.",
    );
  }

  return {
    name: intent.declaredFileName ?? null,
    mimetype: intent.declaredContentType ?? null,
    size: intent.declaredSizeBytes ?? 0,
    uploadId,
    file: null,
  };
};

/**
 * The same, for a list — in the order the accepts will happen.
 *
 * ⚠️ Files first, then ids, which is the order `acceptUploads` already uses.
 * Sort order and poster pairing both follow this list, so the two must not
 * disagree about what "the third item" means.
 */
exports.describeAllIncoming = async (actor, options = {}) => {
  const { files = [], uploadIds = [], purpose } = options;

  const list = Array.isArray(files) ? files : [files].filter(Boolean);
  const ids = Array.isArray(uploadIds) ? uploadIds : [uploadIds].filter(Boolean);

  const described = [];
  for (const item of list) {
    described.push(
      await exports.describeIncoming(actor, { file: item, purpose }),
    );
  }
  for (const id of ids) {
    described.push(
      await exports.describeIncoming(actor, { uploadId: id, purpose }),
    );
  }
  return described.filter(Boolean);
};
