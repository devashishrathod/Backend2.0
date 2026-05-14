const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteFeedbackReply } = require("../../service/feedbackServices");

exports.deleteFeedbackReply = asyncWrapper(async (req, res, next) => {
  const userId = req.payload?._id;
  const feedbackReplyId = req.params.feedbackReplyId;
  await deleteFeedbackReply(userId, feedbackReplyId);
  return sendSuccess(res, 201, "Review deleted successfully");
});
