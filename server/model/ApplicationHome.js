const mongoose = require("mongoose");
const { PLATFORMS } = require("../constants");

const applicationHomeSchema = new mongoose.Schema(
  {
    image: { type: String },
    title: { type: String },
    header: { type: String },
    description: { type: String },
    colourCode: { type: String },
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

module.exports = mongoose.model("ApplicationHome", applicationHomeSchema);
