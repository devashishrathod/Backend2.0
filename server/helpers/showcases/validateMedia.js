const path = require("path");
const { SHOWCASE_COVER_IMAGE_MODE } = require("../../constants/showcase");
const { MEDIA_KIND } = require("../../constants/storage");
const { throwError } = require("../../utils");

exports.normalizeFiles = (files) => {
  if (!files) return [];
  return Array.isArray(files) ? files : [files];
};

exports.validateFilesExist = (files) => {
  if (!files.length) {
    throwError(400, "Please upload at least one image or video.");
  }
};

exports.countImages = (files = []) => {
  return files.filter((file) => file.mimetype.startsWith("image")).length;
};

exports.countVideos = (files = []) => {
  return files.filter((file) => file.mimetype.startsWith("video")).length;
};

exports.getFileNameWithoutExtension = (fileName) => {
  if (!fileName) return "";
  return path.parse(fileName).name;
};

exports.validateMediaFiles = (
  files,
  config,
  existingImages = 0,
  existingVideos = 0,
) => {
  exports.validateFilesExist(files);
  if (!config) {
    throwError(500, "Showcase configuration not found.");
  }
  const newImages = exports.countImages(files);
  const newVideos = exports.countVideos(files);
  const totalImages = existingImages + newImages;
  const totalVideos = existingVideos + newVideos;
  const totalItems = totalImages + totalVideos;
  if (totalItems > config.maxItems) {
    throwError(
      400,
      `Maximum ${config.maxItems} media items are allowed in one section.`,
    );
  }
  if (totalImages > config.maxImages) {
    throwError(400, `Maximum ${config.maxImages} images are allowed.`);
  }
  if (totalVideos > config.maxVideos) {
    throwError(400, `Maximum ${config.maxVideos} videos are allowed.`);
  }
  for (const file of files) {
    const mime = file.mimetype;
    if (mime.startsWith("image")) {
      if (!config.allowedImages.includes(mime)) {
        throwError(400, `${file.name} image format is not supported.`);
      }
      const sizeMB = file.size / 1024 / 1024;
      if (sizeMB > config.maxImageSizeMB) {
        throwError(
          400,
          `${file.name} exceeds maximum image size of ${config.maxImageSizeMB} MB.`,
        );
      }
    } else if (mime.startsWith("video")) {
      if (!config.allowedVideos.includes(mime)) {
        throwError(400, `${file.name} video format is not supported.`);
      }
      const sizeMB = file.size / 1024 / 1024;
      if (sizeMB > config.maxVideoSizeMB) {
        throwError(
          400,
          `${file.name} exceeds maximum video size of ${config.maxVideoSizeMB} MB.`,
        );
      }
    } else {
      throwError(400, `${file.name} is not a supported media file.`);
    }
  }
};

/**
 * A replacement video poster.
 *
 * Went unvalidated entirely: any file the vendor attached as `thumbnail` was
 * pushed to Cloudinary and stored, so a 40 MB TIFF — or a video — could end up
 * as a section's poster frame.
 */
exports.validateThumbnailFile = (file, config) => {
  if (!file) throwError(400, "Thumbnail file is required.");
  if (!config) throwError(500, "Showcase configuration not found.");

  const mime = file.mimetype || "";
  if (!mime.startsWith("image") || !config.allowedImages.includes(mime)) {
    throwError(400, "Thumbnail must be an image in a supported format.");
  }

  const sizeMB = file.size / 1024 / 1024;
  if (sizeMB > config.maxImageSizeMB) {
    throwError(
      400,
      `Thumbnail exceeds maximum image size of ${config.maxImageSizeMB} MB.`,
    );
  }
};

/**
 * Turn freshly uploaded assets into media subdocuments.
 *
 * `isShowInVideoClips` is a VIDEO-only switch, so a photo is always stored with
 * it off. It used to be stamped onto every row, which left photos carrying a
 * `true` that nothing could ever act on — and a toggle in the vendor panel that
 * did nothing.
 */
exports.prepareMediaDocuments = (
  medias = [],
  startSort = 1,
  isShowInVideoClips = true,
) => {
  return medias.map((media, index) => ({
    // ⚠️ The whole `mediaSchema` value goes in as one field. It used to be
    // unpacked into `type` / `url` / `thumbnail` / `storage` / `metadata`, which
    // is how a gallery item ended up carrying the platform's only per-surface
    // copy of file metadata.
    media,
    title: exports.getFileNameWithoutExtension(media.originalName),
    altText: exports.getFileNameWithoutExtension(media.originalName),
    sortOrder: startSort + index,
    isShowInVideoClips:
      media.kind === MEDIA_KIND.VIDEO ? isShowInVideoClips : false,
    isActive: true,
    isDeleted: false,
    deletedAt: null,
  }));
};

exports.getExistingMediaCounts = (medias = []) => {
  return medias.reduce(
    (result, item) => {
      if (item.isDeleted) {
        return result;
      }
      // Counted by what the file **is**, not by a stored label beside it. A GIF
      // counts against the image ceiling, which is what a vendor expects.
      if (item.media?.kind === MEDIA_KIND.VIDEO) {
        result.videos++;
      } else if (item.media?.kind) {
        result.images++;
      }
      return result;
    },
    {
      images: 0,
      videos: 0,
    },
  );
};

exports.getNextMediaSortOrder = (medias = []) => {
  if (!medias.length) return 1;
  return Math.max(...medias.map((media) => media.sortOrder || 0)) + 1;
};

exports.normalizeSortOrder = (items = []) => {
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item, index) => ({
      ...item,
      sortOrder: index + 1,
    }));
};

// `id` is what the validators accept and what the docs publish. The default
// used to be `sectionId`, a key no payload ever carries, so any caller that
// forgot to pass the key dereferenced `undefined` and answered 500.
exports.validateUniqueIds = (items = [], key = "id") => {
  const ids = new Set();
  for (const item of items) {
    const value = item[key].toString();
    if (ids.has(value)) {
      throwError(400, `Duplicate ${key} found.`);
    }
    ids.add(value);
  }
};

exports.validateUniqueSortOrders = (items = [], key = "sortOrder") => {
  const values = new Set();
  for (const item of items) {
    if (values.has(item[key])) {
      throwError(400, "Duplicate sort order found.");
    }
    values.add(item[key]);
  }
};

/**
 * The displayable image for one gallery item.
 *
 * 🔴 A video answers its **poster**, and nothing else — never the `.mp4`.
 *
 * This used to be `thumbnail || url`, and the fallback was the bug: on S3 no
 * poster was ever produced, so the moment a video sorted to the top of a section
 * its `coverImage` became a video file, and every card rendering it showed a
 * broken image. The old comment in the S3 provider claimed a missing thumbnail
 * made the cover "fall through to the next visible media" — it did not.
 *
 * A poster is mandatory on a VIDEO now, so the `||` has nothing left to do; if
 * one is somehow missing, `null` is the honest answer and the caller can fall
 * back deliberately rather than by accident.
 */
exports.getMediaCoverImage = (item) => {
  const media = item?.media;
  if (!media) return null;
  if (media.kind === MEDIA_KIND.VIDEO) return media.poster?.url ?? null;
  return media.url ?? null;
};

/** The first visible media of a section, in display order. */
exports.pickCoverMedia = (medias = []) => {
  let cover = null;
  for (const media of medias) {
    if (media.isDeleted || !media.isActive) continue;
    if (!cover || media.sortOrder < cover.sortOrder) cover = media;
  }
  return cover;
};

/**
 * Recompute a section's cover from its media, in place.
 *
 * Honours `coverImageMode`: MANUAL means the vendor pinned a cover, so add /
 * delete / reorder must leave it alone. The field existed on the model but
 * nothing read it, so a manual cover was silently overwritten by the next
 * reorder.
 *
 * 🔴 **A pin can outlive the thing it points at.** The vendor pins media #5 and
 * then deletes it — or hides it — and without the check below the section keeps
 * pointing at a file that is gone, because the MANUAL branch simply returned.
 * The result is a dead tile on the brand's public profile, from an ordinary
 * delete that reported success.
 *
 * So a pin is verified, not trusted: still there, not deleted, still visible.
 * If any of that fails the section drops back to AUTO and recomputes. Losing
 * the pin is a smaller loss than showing a broken picture — and the media it
 * named is not there to show anyway.
 *
 * ⚠️ When the pin *is* still good the URL is refreshed rather than left alone,
 * so replacing the pinned media's file moves the cover with it. That is what
 * pinning an **id** buys over pinning a URL.
 *
 * ⚠️ Callers that load the section with a projection must include
 * `coverMediaId`, or every pin here looks dangling and quietly resets to AUTO.
 */
exports.syncSectionCoverImage = (section) => {
  if (section.coverImageMode === SHOWCASE_COVER_IMAGE_MODE.MANUAL) {
    const pinned = section.coverMediaId
      ? section.medias?.id?.(section.coverMediaId)
      : null;

    if (pinned && !pinned.isDeleted && pinned.isActive) {
      section.coverImage = exports.getMediaCoverImage(pinned);
      return;
    }

    section.coverImageMode = SHOWCASE_COVER_IMAGE_MODE.AUTO;
    section.coverMediaId = undefined;
  }

  section.coverImage = exports.getMediaCoverImage(
    exports.pickCoverMedia(section.medias),
  );
};
