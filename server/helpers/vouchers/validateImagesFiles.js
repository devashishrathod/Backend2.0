const { throwError } = require("../../utils");
const storage = require("../../services/storage");
const { UPLOAD_PURPOSE, MEDIA_KIND } = require("../../constants/storage");
const { assertImageFile, toMediaDocument } = require("../media");

/**
 * The uploaded images as a flat array, whatever shape the middleware gave them.
 *
 * `express-fileupload` hands over a single file as an object and several as an
 * array, and some callers pass the whole `req.files` bag — so all three arrive
 * here and all three have to come out the same.
 *
 * ### ⚠️ An object that is not a file is not a file
 *
 * `{}` used to come out as `[{}]` — one phantom image, with no name, no mime
 * type and no path. Nothing downstream could tell it from a real upload until
 * `assertImageFile` refused it with *"Received 'no content type'"*, which reads
 * like the vendor sent something broken rather than nothing at all.
 *
 * Today's controllers pass `req.files?.newImages` and `req.files`, both of which
 * are `undefined` when nothing was attached, so this was never reachable from
 * the API — it was reachable from a test, and it cost one. A file has at least
 * one of the three markers below; an empty bag has none.
 */
const looksLikeFile = (value) =>
  Boolean(value) &&
  (value.tempFilePath !== undefined ||
    value.name !== undefined ||
    value.mimetype !== undefined ||
    value.data !== undefined);

exports.normalizeVoucherImages = (files) => {
  if (!files) return [];
  let images = files;
  if (files.files !== undefined) images = files.files;
  if (!Array.isArray(images)) images = looksLikeFile(images) ? [images] : [];
  return images.filter(Boolean);
};

/**
 * What a voucher's uploaded images have to satisfy before anything is stored.
 *
 * ⚠️ Takes the whole `getVoucherConfig()` result rather than a bare number. It
 * used to take `maxImages` alone, which is exactly why there was nowhere to put
 * a size limit — see below.
 *
 * @param {object|number} config  the voucher config; a bare number is still
 *        accepted so a caller mid-refactor cannot silently lose the count check
 */
exports.validateVoucherImages = (files, config = {}) => {
  const { maxImages = 5, maxBytes, maxSizeMB } =
    typeof config === "number" ? { maxImages: config } : config;

  const images = exports.normalizeVoucherImages(files);
  if (images.length > maxImages) {
    throwError(400, `Maximum ${maxImages} voucher images are allowed.`);
  }
  /**
   * 🔴 This was `mimeType.startsWith("image/")`, which `image/svg+xml` passes.
   *
   * An SVG is an XML document and can carry a `<script>`. It survives today
   * only because these are served from a Cloudinary domain, where a panel
   * session is cross-origin and out of reach — and that protection disappears
   * the moment media moves to our own CDN. An explicit allow-list has no such
   * dependency on where the file happens to be hosted.
   */
  for (const file of images) {
    assertImageFile(file, "Voucher image");
    assertVoucherImageSize(file, { maxBytes, maxSizeMB });
  }
  return images;
};

/**
 * 🔴 P12 — voucher images had **no size check at all**.
 *
 * Mime type was checked, the count was checked, and then a 200 MB JPEG went
 * through: uploaded, paid for, and served to every customer whose listing
 * included that voucher. Every other media surface on the platform has had a
 * ceiling for months; this one was simply missed.
 *
 * ⚠️ The limit is the **global** one from `Setting.storage.limits`, not a
 * voucher-specific field. There is nothing about a voucher image that needs a
 * different ceiling from every other image, and a second number answering the
 * same question is only safe when it is written down which one wins.
 *
 * Silent when the config carries no limits, so a caller that has not been
 * updated keeps its old behaviour instead of refusing every upload — the count
 * and mime checks above still run either way.
 */
const assertVoucherImageSize = (file, { maxBytes, maxSizeMB }) => {
  const limit = maxBytes?.[MEDIA_KIND.IMAGE];
  if (!Number.isFinite(limit)) return;

  const size = Number(file?.size);
  if (!Number.isFinite(size) || size <= limit) return;

  const capMB = maxSizeMB?.[MEDIA_KIND.IMAGE] ?? Math.round(limit / (1024 * 1024));
  throwError(
    400,
    `${file.name || "Voucher image"} exceeds maximum image size of ${capMB} MB.`,
  );
};

/**
 * ### ⚠️ It takes **descriptions**, not files (U-4)
 *
 * `items` is what `describeAllIncoming` answered: `{ name, mimetype, size }`
 * plus exactly one of `file` or `uploadId`. Both roads produce the same shape,
 * so everything above reads the same fields it always did — and which road each
 * image came down stops being this file's business.
 *
 * @param actor      whose upload it is — the facade looks an intent up by id
 *                   **and** owner, so a signed permission is not transferable
 * @param voucherId  goes into the object key.
 * @returns {Promise<Array>} `mediaSchema` values, in the order the items came
 *
 * ⚠️ No `sortOrder` here any more. It used to be stamped onto the upload result,
 * which mixed "what this file is" with "where it sits in the gallery" — the two
 * things M-5 pulled apart. The caller assigns positions when it builds the
 * image rows, and it is the only place that knows about the images already
 * there.
 */
exports.uploadVoucherImages = async (actor, items, voucherId) => {
  const uploaded = [];
  try {
    for (const item of items) {
      const uploadedImage = await storage.acceptUpload(actor, {
        file: item.file,
        uploadId: item.uploadId,
        purpose: UPLOAD_PURPOSE.VOUCHER_IMAGE,
        entityId: voucherId,
      });
      uploaded.push(toMediaDocument(uploadedImage));
    }
    return uploaded;
  } catch (error) {
    // 🔴 Rollback used to delete by URL, which meant `deleteFile` compared the
    // URL against `CLOUD_BASE_URL` and quietly gave up on anything that did not
    // match. Every image uploaded before the failure then stayed on storage
    // forever, paid for and unreferenced. The upload result already carries its
    // `storage`, so the delete now follows that.
    await storage.deleteAssets(uploaded);
    // The original failure was being thrown away, so "Failed to upload voucher
    // images" was the only trace of a quota, a credential or a network error.
    console.error("Voucher image upload failed:", error.message);
    throwError(500, "Failed to upload voucher images.");
  }
};

exports.rollbackVoucherImages = async (uploadedImages) => {
  if (!Array.isArray(uploadedImages)) return;
  await storage.deleteAssets(uploadedImages);
};
