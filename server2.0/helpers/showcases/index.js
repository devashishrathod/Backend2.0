const { generateUniqueSlug } = require("./generateUniqueSlug");
const {
  normalizeFiles,
  validateFilesExist,
  countImages,
  countVideos,
  validateMediaFiles,
  prepareMediaDocuments,
  getExistingMediaCounts,
  getNextMediaSortOrder,
  normalizeSortOrder,
  validateUniqueIds,
  validateUniqueSortOrders,
  syncSectionCoverImage,
} = require("./validateMedia");
const {
  uploadSingleMedia,
  uploadMultipleMedia,
  rollbackUploads,
  deleteMedia,
  deleteAllMedia,
} = require("./upload");

module.exports = {
  generateUniqueSlug,
  normalizeFiles,
  validateFilesExist,
  countImages,
  countVideos,
  validateMediaFiles,
  prepareMediaDocuments,
  getExistingMediaCounts,
  getNextMediaSortOrder,
  normalizeSortOrder,
  validateUniqueIds,
  validateUniqueSortOrders,
  syncSectionCoverImage,
  uploadSingleMedia,
  uploadMultipleMedia,
  rollbackUploads,
  deleteMedia,
  deleteAllMedia,
};
