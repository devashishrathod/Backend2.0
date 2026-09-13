const { throwError } = require("../../utils");
const { SHOWCASE_MEDIA_TYPE } = require("../../constants/showcase");
const storage = require("../storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");
const { getShowcaseConfig } = require("../../helpers/settings");
const {
  resolveSectionForActor,
  validateThumbnailFile,
  deleteCustomThumbnail,
  syncSectionCoverImage,
  formatManagedMedia,
  rollbackUploads,
} = require("../../helpers/showcases");

/**
 * Edit one media's own fields.
 *
 * `isShowInVideoClips` is rejected outright on a photo rather than being stored
 * and ignored. It is a video-only switch — the clips feed filters on
 * `type === VIDEO` before it ever looks at the flag — so accepting it on a photo
 * only ever produced a toggle in the panel that did nothing. Same rule for a
 * custom `thumbnail`: a photo already *is* its own thumbnail.
 *
 * Ordering is deliberate: the new poster goes up first, the document is saved,
 * and only then is the old poster deleted. A failure anywhere before the save
 * rolls the upload back, so a request either changes both or neither.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 */
exports.updateSectionMedia = async (actor, payload, thumbnailFile) => {
  const { sectionId, mediaId, title, altText, isShowInVideoClips, isActive } =
    payload;

  // The body may legitimately be empty when a thumbnail file is attached, so
  // "at least one field" is checked here rather than in the validator.
  const hasFieldUpdate = [title, altText, isShowInVideoClips, isActive].some(
    (value) => value !== undefined,
  );
  if (!hasFieldUpdate && !thumbnailFile) {
    throwError(400, "Please provide at least one field to update.");
  }

  // The whole media array is loaded on purpose. Projecting a single element with
  // `$elemMatch` and then calling `save()` would make Mongoose write positional
  // paths (`medias.0.…`) against the *projected* index — which is not the index
  // in the stored document.
  const section = await resolveSectionForActor(actor, sectionId, {
    projection: { medias: 1, coverImage: 1, coverImageMode: 1 },
  });

  const media = section.medias.id(mediaId);
  if (!media || media.isDeleted) throwError(404, "Media not found.");

  const isVideo = media.type === SHOWCASE_MEDIA_TYPE.VIDEO;

  if (isShowInVideoClips !== undefined && !isVideo) {
    throwError(
      422,
      "isShowInVideoClips applies to video media only. This media is a photo.",
    );
  }
  if (thumbnailFile && !isVideo) {
    throwError(
      422,
      "A custom thumbnail can only be set on video media. This media is a photo.",
    );
  }

  // `!== undefined`, so a vendor can clear a title or alt text with `""`.
  if (title !== undefined) media.title = title.trim();
  if (altText !== undefined) media.altText = altText.trim();
  if (isActive !== undefined) media.isActive = isActive;
  if (isShowInVideoClips !== undefined) {
    media.isShowInVideoClips = isShowInVideoClips;
  }

  const previousThumbnail = media.thumbnail;
  const previousMedia = media.toObject();
  let uploadedThumbnail = null;

  if (thumbnailFile) {
    const config = await getShowcaseConfig();
    validateThumbnailFile(thumbnailFile, config);
    // Not swallowed any more. The upload failure used to be logged and the
    // request answered `200`, so the vendor was told their new poster had been
    // saved while the old one was still live.
    //
    // ⚠️ The whole upload result is kept, not just its URL. `thumbnailStorage`
    // is what marks this poster as one the vendor uploaded — without it,
    // `isCustomThumbnail` has to guess from the URL, which is exactly the check
    // that cannot work on S3.
    uploadedThumbnail = await storage.uploadFromPath({
      filePath: thumbnailFile.tempFilePath,
      originalFile: thumbnailFile,
      purpose: UPLOAD_PURPOSE.SHOWCASE_THUMBNAIL,
      entityId: section._id,
    });
    media.thumbnail = uploadedThumbnail.url;
    media.thumbnailStorage = uploadedThumbnail.storage;
  }

  // The cover follows the first visible media, so switching one off or changing
  // its poster can move it. A no-op when the vendor pinned the cover manually.
  syncSectionCoverImage(section);

  try {
    await section.save();
  } catch (error) {
    // The upload result already carries its own `storage`, so the provider
    // comes from the upload rather than being asserted here.
    if (uploadedThumbnail) await rollbackUploads([uploadedThumbnail]);
    throw error;
  }

  if (uploadedThumbnail && previousThumbnail) {
    // Only if the vendor had uploaded that poster themselves — a video's
    // default poster is derived from the video's own public id, and destroying
    // it would take the video with it.
    await deleteCustomThumbnail(previousMedia);
  }

  return formatManagedMedia(media);
};
