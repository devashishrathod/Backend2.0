const crypto = require("crypto");
const path = require("path");

const {
  MEDIA_KIND,
  MEDIA_KIND_PREFIX,
  UPLOAD_PURPOSES,
  UPLOAD_PURPOSE,
} = require("../../constants/storage");
const { config } = require("../../configs/env");
const { throwError } = require("../../utils");

/**
 * Building the object key — the one place that decides where a file lands.
 *
 * Shape: `<prefix><type>/<entity>/<entityId>/<uuid>.<ext>`
 *
 * ⚠️ **A new uuid on every upload, never a reused key.** Reusing
 * `brands/<id>/logo.webp` would mean every logo change needs a CloudFront
 * invalidation — which costs money and, when somebody forgets, serves the old
 * logo for months. Fresh keys let the CDN cache `immutable` forever and make a
 * deleted object 404 honestly.
 */

/** The extension a mime type should be written with. */
const EXT_BY_MIME = Object.freeze({
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "application/pdf": "pdf",
});

/**
 * ⚠️ Mime first, file name second.
 *
 * The name comes from the client and can say anything; by the time a key is
 * built the mime type has been checked against the surface's allow-list. Where
 * the name is all there is, it is stripped to letters and digits — an extension
 * is about to become part of a path, and `../` in a path is how a key escapes
 * its prefix.
 */
const extensionFor = (mime, originalName) => {
  const known = EXT_BY_MIME[String(mime || "").toLowerCase()];
  if (known) return known;

  const raw = path.extname(String(originalName || "")).slice(1);
  const safe = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return safe || "bin";
};

/**
 * One path segment, made safe.
 *
 * Ids here are Mongo ObjectIds in every current caller, but this runs on
 * whatever it is given. `..`, `/` and `\` would all move the object somewhere
 * it was never meant to go, so only the characters an id actually needs survive.
 */
const segment = (value, label) => {
  const safe = String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throwError(500, `Cannot build a storage key without ${label}.`);
  return safe;
};

/** `dev/`, `staging/`, or nothing at all in production. */
const prefix = () => {
  const raw = config.S3_PREFIX || "";
  if (!raw) return "";
  return raw.endsWith("/") ? raw : `${raw}/`;
};

const purposeConfig = (purpose) => {
  const entry = UPLOAD_PURPOSES[purpose];
  if (!entry) throwError(500, `Unknown upload purpose: ${purpose}`);
  return entry;
};

/**
 * `<prefix><type>/<entity>/<entityId>/<uuid>.<ext>`
 *
 * The kind decides the first segment, and it is checked against what the
 * purpose allows — a video reaching a logo field should fail loudly here rather
 * than sit in `videos/brands/` looking deliberate.
 */
const buildKey = ({ purpose, entityId, kind, mime, originalName }) => {
  const entry = purposeConfig(purpose);

  if (!MEDIA_KIND[kind]) throwError(500, `Unknown media kind: ${kind}`);
  if (!entry.kinds.includes(kind)) {
    throwError(422, `${purpose} does not accept ${kind} files.`);
  }

  const type = MEDIA_KIND_PREFIX[kind];
  const owner = segment(entityId, `an id for ${purpose}`);
  const ext = extensionFor(mime, originalName);

  return `${prefix()}${type}/${entry.entity}/${owner}/${crypto.randomUUID()}.${ext}`;
};

/**
 * Documents are the one surface with a meaningful, stable name.
 *
 * `documentNumber` is already unique, already allotted from an atomic counter
 * and already printed on the paper, so a uuid would only make the object harder
 * to find when somebody is looking for one specific bill. Nothing overwrites
 * here either: a number is issued once.
 *
 *     TD/VCH/26-27/000001
 *      │   │    │      └── sequence, monotonic within the series
 *      │   │    └───────── Indian financial year
 *      │   └────────────── series — VCH claim · SUB subscription · REF refund …
 *      └────────────────── issuer
 *
 *  →  documents/26-27/VCH/TD-VCH-26-27-000001.pdf
 *
 * ⚠️ The number's own slashes are **not** reused as path separators. They would
 * work, but the year and series would then be decided by where a slash happened
 * to fall in a string — so the two segments that matter for browsing and for
 * lifecycle rules are lifted out deliberately, and the file name keeps the whole
 * number so an object can be matched to a document by eye.
 */
const DOCUMENT_NUMBER_PARTS = /^([A-Z]+)\/([A-Z]+)\/([\d-]+)\/(\d+)$/;

const buildDocumentKey = (documentNumber) => {
  const raw = String(documentNumber ?? "").trim();
  const parts = DOCUMENT_NUMBER_PARTS.exec(raw);

  if (!parts) {
    throwError(500, `Not a document number: ${JSON.stringify(documentNumber)}`);
  }

  const [, , series, year] = parts;
  const slug = segment(raw.replace(/\//g, "-"), "a document number");

  return (
    `${prefix()}${MEDIA_KIND_PREFIX[MEDIA_KIND.DOCUMENT]}/` +
    `${segment(year, "a year")}/${segment(series, "a series")}/${slug}.pdf`
  );
};

/**
 * Everything that has not been looked at yet, under one root.
 *
 * ### 🔴 Why `staging/` comes **before** the tier prefix, not after
 *
 * It used to be `<prefix>staging/…`, which put dev's unconfirmed uploads at
 * `dev/staging/…` and staging's at `stg/staging/…`. Both the bucket policy that
 * denies public reads and the lifecycle rule that expires abandonments are
 * **literal prefixes** — a policy written for `staging/*` matched neither, and
 * an S3 lifecycle prefix cannot use a wildcard at all. Measured on the live
 * distribution: `staging/` answered 403 and `dev/staging/` answered **200**, so
 * every not-yet-validated upload was world-readable and nothing ever swept it.
 *
 * `staging/` is a **state**, not a place — "nobody has read these bytes". The
 * rule that protects it keys on exactly that, so that is what has to be
 * outermost. The tier prefix keeps its job one segment in:
 *
 *     staging/dev/<userId>/<uuid>.<ext>
 *     staging/stg/<userId>/<uuid>.<ext>
 *     staging/<userId>/<uuid>.<ext>        ← production, where prefix is empty
 *
 * One `staging/*` deny and one `staging/` lifecycle rule now cover every tier
 * and both buckets, and a new environment needs no change in AWS at all.
 *
 * ⚠️ Deliberately **outside** the type tree. A key like `images/…` is a claim
 * about content, and at this point the only evidence for that claim is what the
 * client said. The object moves under its real type prefix after the magic-byte
 * check, and a lifecycle rule expires whatever never got that far.
 */
const stagingPrefix = () => `staging/${prefix()}`;

/**
 * Where a presigned upload lands before anybody has seen the bytes (Phase 5).
 *
 * ⚠️ Built from `stagingPrefix()` and nothing else. `preflight.js` writes its
 * round-trip probe under the same root, and a second copy of this string is how
 * the two would drift until one of them sat outside the rule that sweeps it.
 */
const buildStagingKey = ({ userId, mime, originalName }) =>
  `${stagingPrefix()}${segment(userId, "a user id")}/${crypto.randomUUID()}.${extensionFor(mime, originalName)}`;

/** Which bucket this purpose writes to — PUBLIC or PRIVATE. */
const bucketFor = (purpose) => purposeConfig(purpose).bucket;

/**
 * The Cloudinary folder for a purpose.
 *
 * Cloudinary has no keys, so the same purpose table is reused to pick a folder.
 * `LEGACY` is handled by the caller, which keeps the historic folder names.
 */
const cloudinaryFolder = ({ purpose, entityId, kind }) => {
  const entry = purposeConfig(purpose);
  const type = MEDIA_KIND_PREFIX[kind] || MEDIA_KIND_PREFIX[MEDIA_KIND.IMAGE];
  const base = `${prefix()}${type}/${entry.entity}`;
  if (purpose === UPLOAD_PURPOSE.DOCUMENT || !entityId) return base;
  return `${base}/${segment(entityId, `an id for ${purpose}`)}`;
};

module.exports = {
  buildKey,
  buildDocumentKey,
  buildStagingKey,
  stagingPrefix,
  bucketFor,
  cloudinaryFolder,
  extensionFor,
  prefix,
};
