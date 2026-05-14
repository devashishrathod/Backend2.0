const mongoose = require("mongoose");
const {
  userField,
  brandField,
  feedbackField,
} = require("./validMogooseObjectId");

const feedbackReplySchema = new mongoose.Schema(
  {
    feedback: feedbackField,
    brand: brandField,
    vendor: userField,
    reply: { type: String, trim: true, required: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("FeedbackReply", feedbackReplySchema);
