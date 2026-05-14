const mongoose = require("mongoose");
const { PLATFORMS } = require("../constants");

const privacySchema = new mongoose.Schema(
  {
    privacy: { type: String },
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

module.exports = mongoose.model("Privacy", privacySchema);
