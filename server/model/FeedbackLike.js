const mongoose = require("mongoose");
const { userField, feedbackField } = require("./validMogooseObjectId");

const feedbackLikeSchema = new mongoose.Schema(
  {
    user: userField,
    feedback: feedbackField,
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

feedbackLikeSchema.index(
  { user: 1, feedback: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

module.exports = mongoose.model("FeedbackLike", feedbackLikeSchema);
