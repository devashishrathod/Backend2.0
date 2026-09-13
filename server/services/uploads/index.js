const storage = require("../storage");
const { MEDIA_KIND, UPLOAD_PURPOSE } = require("../../constants/storage");
const { buildDocumentKey } = require("../storage/keys");

/**
 * What is left of the old upload surface.
 *
 * Everything else moved to `services/storage`, where the call site names a
 * purpose and an entity id. `uploadAudio` stays because it has no caller
 * anywhere in the app and was kept deliberately — no `audio/` prefix will exist
 * until something calls it.
 */

/**
 * Put a rendered document where only a signed link can reach it.
 *
 * 🔴 `UPLOAD_PURPOSE.DOCUMENT` is the **private** bucket — the one with Block
 * Public Access on and no CloudFront in front of it. These files carry a
 * customer's name, address, GSTIN and the amount they paid, and until now they
 * sat on a public delivery URL built from `Math.random()`, permanent and
 * guessable. `documentToken` could be revoked; that URL could not.
 *
 * The key is the document number, not a uuid: it is already unique, already
 * allotted from an atomic counter and already printed on the paper, so an
 * object can be matched to a document by eye. Nothing overwrites — a number is
 * issued once.
 *
 * ⚠️ Returns the **whole** result, not a URL. A private object has no lasting
 * URL by design; the caller stores `storage` and mints a short-lived link per
 * request. On Cloudinary `url` is still there and still the only link there is.
 *
 * @param {string} pdfPath        the rendered file on disk
 * @param {string} documentNumber e.g. `TD/VCH/26-27/000001`
 */
exports.uploadDocument = async (pdfPath, documentNumber) => {
  const key = buildDocumentKey(documentNumber);

  const media = await storage.uploadFromPath({
    filePath: pdfPath,
    purpose: UPLOAD_PURPOSE.DOCUMENT,
    kind: MEDIA_KIND.DOCUMENT,
    originalFile: {
      name: `${documentNumber.replace(/\//g, "-")}.pdf`,
      mimetype: "application/pdf",
    },
    key,
    // Cloudinary has no keys — it takes the same name as a `public_id`, so both
    // providers end up with one object per document number.
    publicId: key.replace(/\.pdf$/i, ""),
  });

  // ⚠️ The temp file is **not** deleted here. `generateAndUploadDocument` owns
  // it and unlinks in a `finally`, which also covers the throwing path — this
  // one only ran on success, and doing it twice just raced its own caller.
  console.log(`Document uploaded: ${documentNumber}`);
  return media;
};

/**
 * Remove a document.
 *
 * Had no caller for a long time, which meant **no generated PDF was ever
 * deleted**. Re-issuing one is now the caller: a replaced document is a file
 * nothing will ever point at again.
 */
exports.deleteDocument = async (asset) =>
  storage.deleteAsset({ ...asset, kind: MEDIA_KIND.DOCUMENT });

/** ⚠️ No caller. Kept on purpose — see the note above. */
exports.uploadAudio = async (audioPath) => {
  const media = await storage.uploadFromPath({
    filePath: audioPath,
    purpose: UPLOAD_PURPOSE.LEGACY,
    kind: MEDIA_KIND.AUDIO,
  });
  return media.url;
};
