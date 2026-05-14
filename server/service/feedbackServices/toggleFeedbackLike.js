const FeedbackLike = require("../../model/FeedbackLike");
const Feedback = require("../../model/Feedback");
const { throwError } = require("../../utils");

exports.toggleFeedbackLike = async (userId, feedbackId) => {
  const feedback = await Feedback.findOne({
    _id: feedbackId,
    isDeleted: false,
    isActive: true,
    isBlocked: false,
  });
  if (!feedback) throwError(404, "Feedback not found.");
  const existing = await FeedbackLike.findOne({
    user: userId,
    feedback: feedbackId,
  });
  if (existing && !existing.isDeleted) {
    await FeedbackLike.updateOne({ _id: existing._id }, { isDeleted: true });
    return { liked: false };
  }
  if (existing && existing.isDeleted) {
    await FeedbackLike.updateOne({ _id: existing._id }, { isDeleted: false });
    return { liked: true };
  }
  await FeedbackLike.create({ user: userId, feedback: feedbackId });
  return { liked: true };
};
