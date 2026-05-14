const mongoose = require("mongoose");
const { PLATFORMS } = require("../constants");

const legalSchema = new mongoose.Schema(
  {
    legal: { type: String },
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

module.exports = mongoose.model("Legal", legalSchema);
