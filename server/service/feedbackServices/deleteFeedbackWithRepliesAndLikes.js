const { ROLES } = require("../../constants");
const Feedback = require("../../model/Feedback");
const FeedbackReply = require("../../model/FeedbackReply");
const FeedbackLike = require("../../model/FeedbackLike");
const User = require("../../model/User");
const { throwError } = require("../../utils");

exports.deleteFeedbackWithRepliesAndLikes = async (userId, feedbackId) => {
  const [user, feedback] = await Promise.all([
    User.findById(userId),
    Feedback.findOne({ _id: feedbackId, isDeleted: false }),
  ]);
  if (!user) throwError(404, "User not found");
  if (!feedback) throwError(404, "Feedback not found");
  const { role, brand: userBrand } = user;
  const isUserOwner = String(feedback?.user) === String(userId);
  const isVendorOwner = String(feedback?.brand) === String(userBrand);
  if (
    (role === ROLES?.USER && !isUserOwner) ||
    (role === ROLES?.VENDOR && !isVendorOwner) ||
    (role !== ROLES?.ADMIN && role !== ROLES?.USER && role !== ROLES?.VENDOR)
  ) {
    throwError(403, "You are not allowed to delete this feedback");
  }
  await Promise.all([
    Feedback.updateOne(
      { _id: feedbackId },
      { $set: { isDeleted: true, isActive: false } }
    ),
    FeedbackReply.updateMany(
      { feedback: feedbackId, isDeleted: false },
      { $set: { isDeleted: true, isActive: false } }
    ),
    FeedbackLike.updateMany(
      { feedback: feedbackId, isDeleted: false },
      { $set: { isDeleted: true } }
    ),
  ]);
};
