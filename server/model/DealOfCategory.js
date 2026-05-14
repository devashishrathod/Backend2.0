const mongoose = require("mongoose");
const { PLATFORMS } = require("../constants");

const dealOfCategorySchema = new mongoose.Schema(
  {
    image: { type: String },
    name: { type: String },
    title: { type: String },
    type: {
      type: String,
      enum: [...Object.values(PLATFORMS)],
      default: PLATFORMS.WEB,
    },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("DealOfCategory", dealOfCategorySchema);
