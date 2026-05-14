const { ROLES } = require("../../constants");
const Feedback = require("../../model/Feedback");
const FeedbackReply = require("../../model/FeedbackReply");
const User = require("../../model/User");
const { throwError } = require("../../utils");

exports.deleteFeedbackReply = async (userId, feedbackReplyId) => {
  const [user, feedbackReply] = await Promise.all([
    User.findById(userId),
    FeedbackReply.findOne({ _id: feedbackReplyId, isDeleted: false }),
  ]);
  if (!user) throwError(404, "User not found");
  if (!feedbackReply) throwError(404, "No feedback reply found");
  const feedback = await Feedback.findOne({
    _id: feedbackReply?.feedback,
    isDeleted: false,
  });
  if (!feedback) throwError(404, "Feedback not found!");
  const { role, brand: userBrand } = user;
  const isUserOwner = String(feedback?.user) === String(userId);
  const isVendorOwner = String(feedback?.brand) === String(userBrand);
  if (
    (role === ROLES?.USER && !isUserOwner) ||
    (role === ROLES?.VENDOR && !isVendorOwner) ||
    (role !== ROLES?.ADMIN && role !== ROLES?.USER && role !== ROLES?.VENDOR)
  ) {
    throwError(403, "You are not allowed to delete this feedback reply");
  }
  await FeedbackReply.updateOne(
    { _id: feedbackReplyId, isDeleted: false },
    { $set: { isDeleted: true, isActive: false } }
  );
};
