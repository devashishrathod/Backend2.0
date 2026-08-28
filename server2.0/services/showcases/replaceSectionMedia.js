const { throwError } = require("../../utils");
const { SHOWCASE_MEDIA_TYPE } = require("../../constants/showcase");
const { getShowcaseConfig } = require("../../helpers/settings");
const {
  resolveSectionForActor,
  normalizeFiles,
  validateMediaFiles,
  uploadSingleMedia,
  rollbackUploads,
  deleteMedia,
  deleteCustomThumbnail,
  syncSectionCoverImage,
  formatManagedMedia,
} = require("../../helpers/showcases");

/** What a file will become once uploaded, from its mime type alone. */
const mediaTypeOf = (file) =>
  file.mimetype?.startsWith("video")
    ? SHOWCASE_MEDIA_TYPE.VIDEO
    : SHOWCASE_MEDIA_TYPE.PHOTO;

/**
 * Swap the file behind one media, keeping its id, position and settings.
 *
 * A photo may only be replaced by a photo and a video by a video — the sort
 * order, the clips opt-in and the section's photo/video quotas are all tied to
 * the type. That check now runs on the incoming mime type *before* the upload;
 * it used to fire after the file was already on Cloudinary, so every rejected
 * request paid for an upload and an immediate rollback.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 */
exports.replaceSectionMedia = async (actor, payload, file) => {
  const section = await resolveSectionForActor(actor, payload.sectionId, {
    projection: { medias: 1, coverImage: 1, coverImageMode: 1 },
  });

  const media = section.medias.id(payload.mediaId);
  if (!media || media.isDeleted || !media.isActive) {
    throwError(404, "Media not found.");
  }

  const uploadedFiles = normalizeFiles(file);
  if (uploadedFiles.length !== 1) {
    throwError(400, "Please upload exactly one media file.");
  }

  const config = await getShowcaseConfig();
  validateMediaFiles(uploadedFiles, config);

  if (mediaTypeOf(uploadedFiles[0]) !== media.type) {
    throwError(
      400,
      `Only ${media.type.toLowerCase()} replacement is allowed for this media.`,
    );
  }

  const oldMedia = media.toObject();
  let uploaded = null;

  try {
    uploaded = await uploadSingleMedia(uploadedFiles[0]);

    media.type = uploaded.type;
    media.url = uploaded.url;
    media.thumbnail = uploaded.thumbnail;
    media.storage = uploaded.storage;
    media.metadata = uploaded.metadata;

    // The cover may have been this media's old poster. Recomputing keeps it
    // pointing at an image that still exists — and at an *image*: comparing
    // against `oldMedia.thumbnail` alone missed the case where the stored cover
    // was a media `url` instead.
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

  // The old asset — and the poster the vendor had uploaded for it, if any —
  // goes only after the document is safely saved.
  try {
    await deleteCustomThumbnail(oldMedia);
    await deleteMedia(oldMedia);
  } catch (err) {
    console.error("Old media delete failed:", err.message);
  }

  return formatManagedMedia(media);
};
