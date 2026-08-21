const mongoose = require("mongoose");
const { customerField, brandField } = require("./validObjectId");

const followSchema = new mongoose.Schema(
  {
    followerId: { ...customerField, required: true },
    followeeId: { ...brandField, required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

followSchema.index(
  { followerId: 1, followeeId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

followSchema.index({ followerId: 1 });

module.exports = mongoose.model("Follow", followSchema);
