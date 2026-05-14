const { toggleFeedbackLike } = require("../../service/feedbackServices");
const { sendSuccess, asyncWrapper } = require("../../utils");

exports.likeOrDislikeFeedback = asyncWrapper(async (req, res) => {
  const { feedbackId } = req.params;
  const userId = req.payload?._id;
  const result = await toggleFeedbackLike(userId, feedbackId);
  return sendSuccess(res, 200, result.liked ? "Liked" : "Disliked", result);
});
