const { createFeedback } = require("./createFeedback");
const { getAllFeedbacks } = require("./getAllFeedbacks");
const { likeOrDislikeFeedback } = require("./likeOrDislikeFeedback");
const { replyToFeedback } = require("./replyToFeedback");
const { deleteFeedback } = require("./deleteFeedback");
const { deleteFeedbackReply } = require("./deleteFeedbackReply");

module.exports = {
  createFeedback,
  getAllFeedbacks,
  likeOrDislikeFeedback,
  replyToFeedback,
  deleteFeedback,
  deleteFeedbackReply,
};
