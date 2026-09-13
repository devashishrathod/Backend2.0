const storage = require("../storage");
const { MEDIA_KIND, UPLOAD_PURPOSE } = require("../../constants/storage");

/**
 * What is left of the old upload surface.
 *
 * Everything else moved to `services/storage`, where the call site names a
 * purpose and an entity id and the key comes out as
 * `<type>/<entity>/<entityId>/<uuid>.<ext>`. These two stay because neither is
 * ready for that yet:
 *
 *   `uploadPDF`   — documents move to the **private** bucket in Phase 4, with a
 *                   key built from the document number rather than a uuid.
 *                   Until that bucket exists they keep the Cloudinary folder
 *                   they have always had.
 *   `uploadAudio` — has no caller anywhere in the app, and is kept deliberately.
 *                   No `audio/` prefix will exist until something calls it.
 *
 * Both go through `UPLOAD_PURPOSE.LEGACY`, which pins them to Cloudinary's
 * historic `Documents` / `Audio` folders so nothing that already exists moves.
 */

exports.uploadPDF = async (pdfPath, fileName) => {
  const media = await storage.uploadFromPath({
    filePath: pdfPath,
    purpose: UPLOAD_PURPOSE.LEGACY,
    kind: MEDIA_KIND.DOCUMENT,
    originalFile: { name: fileName, mimetype: "application/pdf" },
    // A document number, not a uuid — somebody looking for one invoice should
    // be able to find it.
    publicId: fileName.replace(/\.pdf$/i, ""),
  });
  // ⚠️ The temp file is **not** deleted here. `generateAndUploadDocument` owns
  // it and unlinks in a `finally`, which also covers the throwing path — this
  // one only ran on success, and doing it twice just raced its own caller.
  console.log(`PDF uploaded: ${media.url}`);
  return media.url;
};

exports.deletePDF = async (url) =>
  storage.deleteAsset({ url, kind: MEDIA_KIND.DOCUMENT });

/** ⚠️ No caller. Kept on purpose — see the note above. */
exports.uploadAudio = async (audioPath) => {
  const media = await storage.uploadFromPath({
    filePath: audioPath,
    purpose: UPLOAD_PURPOSE.LEGACY,
    kind: MEDIA_KIND.AUDIO,
  });
  return media.url;
};
