const path = require("path");
const {
  SHOWCASE_MEDIA_TYPE,
  SHOWCASE_COVER_IMAGE_MODE,
} = require("../../constants/showcase");
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
    type: media.type,
    url: media.url,
    thumbnail: media.thumbnail,
    storage: media.storage,
    metadata: media.metadata,
    title: exports.getFileNameWithoutExtension(media.metadata?.originalName),
    altText: exports.getFileNameWithoutExtension(media.metadata?.originalName),
    sortOrder: startSort + index,
    isShowInVideoClips:
      media.type === SHOWCASE_MEDIA_TYPE.VIDEO ? isShowInVideoClips : false,
    isActive: true,
    isDeleted: false,
    deletedAt: null,
  }));
};

exports.getExistingMediaCounts = (medias = []) => {
  return medias.reduce(
    (result, media) => {
      if (media.isDeleted) {
        return result;
      }
      if (media.type === SHOWCASE_MEDIA_TYPE.PHOTO) {
        result.images++;
      }
      if (media.type === SHOWCASE_MEDIA_TYPE.VIDEO) {
        result.videos++;
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
 * The displayable image for one media.
 *
 * `thumbnail` first, always. Reading `url` first meant that as soon as a video
 * sorted to the top of a section, `coverImage` became an `.mp4` link and every
 * card that rendered it showed a broken image.
 */
exports.getMediaCoverImage = (media) =>
  media?.thumbnail || media?.url || null;

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
 */
exports.syncSectionCoverImage = (section) => {
  if (section.coverImageMode === SHOWCASE_COVER_IMAGE_MODE.MANUAL) return;
  section.coverImage = exports.getMediaCoverImage(
    exports.pickCoverMedia(section.medias),
  );
};
