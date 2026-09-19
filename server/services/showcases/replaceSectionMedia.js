const { throwError } = require("../../utils");
const { showcaseTypeOf } = require("../../constants/showcase");
const { MEDIA_KIND, kindFromMime } = require("../../constants/storage");
const { getShowcaseConfig } = require("../../helpers/settings");
const { describeIncoming } = require("../storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");
const {
  resolveSectionForActor,
  normalizeFiles,
  validateMediaFiles,
  validateThumbnailFile,
  uploadSingleMedia,
  rollbackUploads,
  deleteMedia,
  syncSectionCoverImage,
  formatManagedMedia,
} = require("../../helpers/showcases");

/**
 * Swap the file behind one media, keeping its id, position and settings.
 *
 * A photo may only be replaced by a photo and a video by a video — the sort
 * order, the clips opt-in and the section's photo/video quotas are all tied to
 * the type. That check runs on the incoming mime type *before* the upload; it
 * used to fire after the file was already on Cloudinary, so every rejected
 * request paid for an upload and an immediate rollback.
 *
 * ⚠️ The comparison is on the **wire type**, not the kind. Swapping a JPEG for a
 * GIF is allowed — both are photos to a gallery, and both count against the same
 * ceiling — while `media.kind` still records which one it actually is, so the
 * GIF lands under `gifs/` and away from the resize step.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 */
exports.replaceSectionMedia = async (actor, payload, file, posterFile) => {
  /**
   * ⚠️ One item, either road (U-3). `describeIncoming` answers
   * `{ name, mimetype, size }` from the file or from the intent row, so every
   * check below reads the same fields it always did — and it runs **before**
   * anything is confirmed, so "only photo replacement is allowed" does not cost
   * the vendor the upload.
   */
  const section = await resolveSectionForActor(actor, payload.sectionId, {
    projection: { medias: 1, coverImage: 1, coverImageMode: 1, coverMediaId: 1 },
  });

  const item = section.medias.id(payload.mediaId);
  if (!item || item.isDeleted || !item.isActive) {
    throwError(404, "Media not found.");
  }

  const incoming = await describeIncoming(actor, {
    file: normalizeFiles(file)[0],
    uploadId: payload.uploadId,
    purpose: UPLOAD_PURPOSE.SHOWCASE_MEDIA,
  });
  if (!incoming || normalizeFiles(file).length > 1) {
    throwError(400, "Please upload exactly one media file.");
  }

  const config = await getShowcaseConfig();
  validateMediaFiles([incoming], config);

  const currentType = showcaseTypeOf(item.media?.kind);
  const nextKind = kindFromMime(incoming.mimetype);
  if (showcaseTypeOf(nextKind) !== currentType) {
    throwError(
      400,
      `Only ${currentType.toLowerCase()} replacement is allowed for this media.`,
    );
  }

  /**
   * 🔴 A replacement video brings its own poster, because nothing derives one.
   *
   * The old code set `thumbnailStorage = undefined` here and relied on the
   * provider having produced a poster automatically. Cloudinary's was a 404 and
   * S3's did not exist, so a replaced video came back with a cover that was
   * either broken or the `.mp4` itself.
   */
  const poster = await describeIncoming(actor, {
    file: posterFile,
    uploadId: payload.thumbnailUploadId,
    purpose: UPLOAD_PURPOSE.SHOWCASE_THUMBNAIL,
  });

  if (nextKind === MEDIA_KIND.VIDEO) {
    if (!poster) {
      throwError(
        422,
        'A video needs a poster image. Attach one as "thumbnail", or name its ' +
          'upload as "thumbnailUploadId".',
      );
    }
    validateThumbnailFile(poster, config);
  }

  const previous = item.media?.toObject?.() ?? item.media;
  let uploaded = null;

  try {
    uploaded = await uploadSingleMedia(actor, incoming, section._id, poster);

    // One assignment where there used to be five, and no marker field to keep
    // in step with it.
    item.media = uploaded;

    // The cover may have been this media's old poster. Recomputing keeps it
    // pointing at an image that still exists — and at an *image*.
    syncSectionCoverImage(section);

    await section.save();
  } catch (error) {
    if (uploaded) await rollbackUploads([uploaded]);
    // A 400 raised inside this block used to be caught below and re-thrown as a
    // 500, so "only photo replacement is allowed" reached the client as
    // "Failed to replace media".
    if (error.statusCode) throw error;
    console.error("Replace section media error:", error.message);
    throwError(500, error.message || "Failed to replace media");
  }

  // The old file — and its poster — go only after the document is safely saved.
  // `deleteMedia` takes the poster with it, so the separate
  // `deleteCustomThumbnail` call this used to need is gone along with the
  // question it answered ("did the vendor upload this poster?").
  try {
    await deleteMedia(previous);
  } catch (err) {
    console.error("Old media delete failed:", err.message);
  }

  return formatManagedMedia(item);
};
