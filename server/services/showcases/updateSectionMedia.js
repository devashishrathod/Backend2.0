const { throwError } = require("../../utils");
const storage = require("../storage");
const { UPLOAD_PURPOSE, MEDIA_KIND } = require("../../constants/storage");
const { getShowcaseConfig } = require("../../helpers/settings");
const {
  resolveSectionForActor,
  validateThumbnailFile,
  syncSectionCoverImage,
  formatManagedMedia,
  rollbackUploads,
  assertSectionKeepsItsFloor,
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
    projection: { medias: 1, coverImage: 1, coverImageMode: 1, coverMediaId: 1 },
  });

  const item = section.medias.id(mediaId);
  if (!item || item.isDeleted) throwError(404, "Media not found.");

  const isVideo = item.media?.kind === MEDIA_KIND.VIDEO;

  if (isShowInVideoClips !== undefined && !isVideo) {
    throwError(
      422,
      "isShowInVideoClips applies to video media only. This media is a photo.",
    );
  }
  /**
   * S-3 — hiding a media is a delete as far as a customer is concerned, so it
   * meets the same floor. A rule that caught only the delete would be one the
   * vendor walks around without meaning to: switch three media off and the
   * section leaves their profile exactly as if they had removed them.
   *
   * 422 rather than the delete's 400 — this is a field on an update being
   * refused, which is the shape the rest of this service already answers with.
   */
  if (isActive === false) {
    await assertSectionKeepsItsFloor(section, {
      mediaId,
      actor,
      statusCode: 422,
    });
  }

  if (thumbnailFile && !isVideo) {
    throwError(
      422,
      "A custom thumbnail can only be set on video media. This media is a photo.",
    );
  }

  // `!== undefined`, so a vendor can clear a title or alt text with `""`.
  if (title !== undefined) item.title = title.trim();
  if (altText !== undefined) item.altText = altText.trim();
  if (isActive !== undefined) item.isActive = isActive;
  if (isShowInVideoClips !== undefined) {
    item.isShowInVideoClips = isShowInVideoClips;
  }

  const previousPoster = item.media?.poster?.toObject?.() ?? item.media?.poster;
  let uploadedThumbnail = null;

  if (thumbnailFile) {
    const config = await getShowcaseConfig();
    validateThumbnailFile(thumbnailFile, config);
    // Not swallowed any more. The upload failure used to be logged and the
    // request answered `200`, so the vendor was told their new poster had been
    // saved while the old one was still live.
    uploadedThumbnail = await storage.uploadFromPath({
      filePath: thumbnailFile.tempFilePath,
      originalFile: thumbnailFile,
      purpose: UPLOAD_PURPOSE.SHOWCASE_THUMBNAIL,
      entityId: section._id,
      kind: MEDIA_KIND.IMAGE,
    });
    /**
     * ⚠️ The poster replaces the one on the media, wholesale.
     *
     * There is no `thumbnailStorage` marker any more, and no question for it to
     * answer. It existed to record "the vendor uploaded this one" so that a
     * *derived* poster would never be deleted — but nothing derives a poster
     * now, so every poster here is one somebody uploaded and every one of them
     * is safe to replace.
     */
    item.media.poster = {
      url: uploadedThumbnail.url,
      storage: uploadedThumbnail.storage,
      width: uploadedThumbnail.metadata?.width ?? null,
      height: uploadedThumbnail.metadata?.height ?? null,
    };
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

  /**
   * The poster this one replaced goes — after the save, never before.
   *
   * ⚠️ No "is this one safe to delete?" check any more. That question existed
   * because a poster could be *derived* from the video, and destroying a derived
   * poster took the video's own asset down with it. Nothing derives a poster, so
   * every stored poster is a separate file that only this media references.
   */
  if (uploadedThumbnail && previousPoster?.url) {
    try {
      await storage.deleteAsset({
        url: previousPoster.url,
        storage: previousPoster.storage,
        kind: MEDIA_KIND.IMAGE,
      });
    } catch (error) {
      // Best effort: an orphaned poster is not worth failing the request over.
      console.error("Old poster delete failed:", error.message);
    }
  }

  return formatManagedMedia(item);
};
