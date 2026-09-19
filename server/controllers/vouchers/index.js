const { create } = require("./create");
const { update } = require("./update");
const { submitForReview } = require("./submitForReview");
const { review } = require("./review");
const { publish } = require("./publish");
const { getAllVersions } = require("./getAllVersions");
const { getAllCustomerVouchers } = require("./getAllCustomerVouchers");
const { getCustomerVoucher } = require("./getCustomerVoucher");
const { previewCustomerVoucher } = require("./previewCustomerVoucher");
const { setBanner } = require("./setBanner");
const { reviewBanner } = require("./reviewBanner");
const { pause, resume } = require("./pauseResume");
const { remove } = require("./remove");
const { reorderImages } = require("./reorderImages");
const { reviewSuggestion } = require("./reviewSuggestion");
const { getSuggestions } = require("./getSuggestions");

module.exports = {
  create,
  update,
  submitForReview,
  review,
  publish,
  getAllVersions,
  getAllCustomerVouchers,
  getCustomerVoucher,
  previewCustomerVoucher,
  setBanner,
  reviewBanner,
  pause,
  resume,
  remove,
  reorderImages,
  reviewSuggestion,
  getSuggestions,
};
