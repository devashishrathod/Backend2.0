const path = require("path");
const { SHOWCASE_MEDIA_TYPE } = require("../../constants/showcase");
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
    isShowInVideoClips,
    isActive: true,
    isDeleted: false,
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

exports.validateUniqueIds = (items = [], key = "sectionId") => {
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

exports.syncSectionCoverImage = (section) => {
  let cover = null;
  for (const media of section.medias) {
    if (media.isDeleted || !media.isActive) continue;
    if (!cover || media.sortOrder < cover.sortOrder) cover = media;
  }
  section.coverImage = cover?.url || cover?.thumbnail || null;
};
