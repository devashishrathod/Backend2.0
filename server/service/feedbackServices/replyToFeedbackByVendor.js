const User = require("../../model/User");
const Feedback = require("../../model/Feedback");
const FeedbackReply = require("../../model/FeedbackReply");
const { throwError } = require("../../utils");

exports.replyToFeedbackByVendor = async (feedbackId, reply, vendorId) => {
  const brandVendor = await User.findOne({ _id: vendorId, isDeleted: false });
  if (!brandVendor) throwError(404, "brand's vendor not found");
  const brandId = brandVendor?.brand;
  if (!feedbackId || !reply) {
    throwError(422, "feedbackId and reply are required.");
  }
  const feedback = await Feedback.findOne({
    _id: feedbackId,
    isDeleted: false,
    isBlocked: false,
  });
  if (!feedback) throwError(404, "Feedback not found");
  if (String(feedback.brand) !== String(brandId)) {
    throwError(403, "You are not allowed to reply on this feedback");
  }
  const alreadyReplied = await FeedbackReply.findOne({
    feedback: feedbackId,
    isDeleted: false,
  });
  if (alreadyReplied) throwError(409, "Reply already exists for this feedback");
  const replyDoc = await FeedbackReply.create({
    feedback: feedbackId,
    brand: brandId,
    vendor: vendorId,
    reply: reply?.trim()?.toLowerCase(),
  });
  return replyDoc;
};
