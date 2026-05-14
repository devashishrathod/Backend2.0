const {
  deleteFeedbackWithRepliesAndLikes,
} = require("../../service/feedbackServices");
const { asyncWrapper, sendSuccess } = require("../../utils");

exports.deleteFeedback = asyncWrapper(async (req, res, next) => {
  const userId = req.payload?._id;
  const feedbackId = req.params.feedbackId;
  await deleteFeedbackWithRepliesAndLikes(userId, feedbackId);
  return sendSuccess(res, 201, "Review deleted successfully");
});
