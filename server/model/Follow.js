const mongoose = require("mongoose");
const { userField, brandField } = require("./validMogooseObjectId");

const followSchema = new mongoose.Schema(
  {
    follower: userField,
    followee: brandField,
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

followSchema.index(
  { follower: 1, followee: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

followSchema.index({ follower: 1 });

module.exports = mongoose.model("Follow", followSchema);
