const mongoose = require("mongoose");
const { mediaSchema } = require("./mediaSchema");
const { DEFAULT_IMAGES } = require("../constants");

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    image: { type: String, default: DEFAULT_IMAGES.CATEGORY },
    // Sibling of the field above — provider + key, so a delete does not have
    // to infer where the bytes are from the URL. Absent on rows written
    // before this existed; `deleteAsset` falls back to the URL for those.
    imageMedia: { type: mediaSchema, default: undefined },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("Category", categorySchema);
