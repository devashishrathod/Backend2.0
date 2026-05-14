const { createReview } = require("./createReview");
const { getAllReviews } = require("./getAllReviews");
const { toggleFeedbackLike } = require("./toggleFeedbackLike");
const { replyToFeedbackByVendor } = require("./replyToFeedbackByVendor");
const {
  deleteFeedbackWithRepliesAndLikes,
} = require("./deleteFeedbackWithRepliesAndLikes");
const { deleteFeedbackReply } = require("./deleteFeedbackReply");

module.exports = {
  createReview,
  getAllReviews,
  toggleFeedbackLike,
  replyToFeedbackByVendor,
  deleteFeedbackWithRepliesAndLikes,
  deleteFeedbackReply,
};
