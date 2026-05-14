const mongoose = require("mongoose");
const { PLATFORMS } = require("../constants");

const filterSchema = new mongoose.Schema(
  {
    name: { type: String },
    type: {
      type: String,
      enum: [...Object.values(PLATFORMS)],
      default: PLATFORMS.WEB,
    },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("Filter", filterSchema);
