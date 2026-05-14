const { asyncWrapper, sendSuccess } = require("../../utils");
const { replyToFeedbackByVendor } = require("../../service/feedbackServices");

exports.replyToFeedback = asyncWrapper(async (req, res, next) => {
  const vendorId = req.payload._id;
  const { feedbackId } = req.params;
  const { reply } = req.body;
  const result = await replyToFeedbackByVendor(feedbackId, reply, vendorId);
  return sendSuccess(res, 201, "Reply submitted successfully", result);
});
