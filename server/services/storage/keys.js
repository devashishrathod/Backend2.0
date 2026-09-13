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
 * `documentNumber` is already unique and already printed on the invoice, so a
 * uuid would only make the object harder to find when someone is looking for
 * one specific bill. Nothing overwrites here either: a document number is
 * issued once.
 */
const buildDocumentKey = ({ year, series, documentNumber }) => {
  const parts = [
    segment(year, "a year"),
    segment(series, "a series"),
    segment(documentNumber, "a document number"),
  ];
  return `${prefix()}${MEDIA_KIND_PREFIX[MEDIA_KIND.DOCUMENT]}/${parts.join("/")}.pdf`;
};

/**
 * Where a presigned upload lands before anybody has seen the bytes (Phase 5).
 *
 * ⚠️ Deliberately **outside** the type tree. A key like `images/…` is a claim
 * about content, and at this point the only evidence for that claim is what the
 * client said. The object moves under its real type prefix after the magic-byte
 * check, and a lifecycle rule expires whatever never got that far.
 */
const buildStagingKey = ({ userId, mime, originalName }) =>
  `${prefix()}staging/${segment(userId, "a user id")}/${crypto.randomUUID()}.${extensionFor(mime, originalName)}`;

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
  bucketFor,
  cloudinaryFolder,
  extensionFor,
  prefix,
};
