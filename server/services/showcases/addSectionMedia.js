const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");
const { SHOWCASE_COVER_IMAGE_MODE } = require("../../constants/showcase");
const {
  normalizeFiles,
  validateMediaFiles,
  prepareMediaDocuments,
  getExistingMediaCounts,
  getNextMediaSortOrder,
  getMediaCoverImage,
  uploadMultipleMedia,
  rollbackUploads,
  resolveSectionForActor,
  formatManagedMedia,
} = require("../../helpers/showcases");
const { getShowcaseConfig } = require("../../helpers/settings");

/**
 * Upload media into a section.
 *
 * `isShowInVideoClips` applies to the videos in the batch only — it is a
 * video-only switch, and `prepareMediaDocuments` stores `false` on every photo
 * regardless of what was sent.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 */
exports.addSectionMedia = async (actor, payload, files) => {
  // One read, reused. Ownership and the "is this section usable" check used to
  // be two separate queries for the same document.
  const section = await resolveSectionForActor(actor, payload.sectionId, {
    projection: { medias: 1, coverImage: 1, coverImageMode: 1, coverMediaId: 1 },
    requireActive: true,
  });

  const uploadedFiles = normalizeFiles(files?.files);
  if (!uploadedFiles.length) {
    throwError(400, "Please upload at least one media.");
  }

  const config = await getShowcaseConfig();
  const { images, videos } = getExistingMediaCounts(section.medias);
  validateMediaFiles(uploadedFiles, config, images, videos);

  /**
   * ⚠️ Posters travel index-aligned with the files they belong to.
   *
   * `thumbnails[2]` is the poster for `files[2]`. A video with no poster at its
   * index is refused before anything is uploaded — `mediaSchema` would refuse it
   * at save time anyway, but by then the video bytes are already paid for.
   */
  const posters = normalizeFiles(files?.thumbnails);

  let uploaded = [];
  try {
    uploaded = await uploadMultipleMedia(uploadedFiles, section._id, posters);
    const startSortOrder = getNextMediaSortOrder(section.medias);
    const medias = prepareMediaDocuments(
      uploaded,
      startSortOrder,
      payload.isShowInVideoClips,
    );

    const update = { $push: { medias: { $each: medias } } };

    // First cover only, and only while the section has none — a vendor who
    // reorders or pins a cover keeps it. `getMediaCoverImage` answers a video
    // with its poster, so a video-first section can no longer end up with an
    // `.mp4` as its cover image.
    const isAutoCover =
      section.coverImageMode !== SHOWCASE_COVER_IMAGE_MODE.MANUAL;
    if (isAutoCover && !section.coverImage) {
      const coverImage = getMediaCoverImage(medias[0]);
      if (coverImage) update.$set = { coverImage };
    }

    await ShowcaseSection.updateOne({ _id: section._id }, update);
    return {
      uploaded: medias.length,
      // ⚠️ Through the managed whitelist. This used to return the prepared
      // documents raw, which carried `storage.publicId` — and later `bucket`
      // and `key` — straight back to the panel.
      medias: medias.map(formatManagedMedia),
    };
  } catch (error) {
    await rollbackUploads(uploaded);
    // A validation failure raised inside this block — an unsupported mime type
    // from `uploadSingleMedia`, say — used to be rewritten as a 500 on the way
    // out, so the client saw "Failed to add media" instead of the real reason.
    if (error.statusCode) throw error;
    console.error("Error adding media to showcase section:", error);
    throwError(
      500,
      error.message || "Failed to add media to showcase section.",
    );
  }
};
