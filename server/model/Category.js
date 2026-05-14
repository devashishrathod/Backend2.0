const mongoose = require("mongoose");
const { PLATFORMS, DEFAULT_IMAGES } = require("../constants");

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    type: {
      type: String,
      enum: [...Object.values(PLATFORMS)],
      default: PLATFORMS.WEB,
    },
    image: { type: String, default: DEFAULT_IMAGES.CATEGORY },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

categorySchema.index(
  { name: 1, type: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

module.exports = mongoose.model("Category", categorySchema);
