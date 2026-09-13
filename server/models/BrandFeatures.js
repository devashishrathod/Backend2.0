const mongoose = require("mongoose");
const { storageSchema } = require("./storageSchema");
const { brandField } = require("./validObjectId");

const brandFeaturesSchema = new mongoose.Schema(
  {
    brandId: { ...brandField, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    icon: { type: String, require: true },
    // Sibling of the field above — provider + key, so a delete does not have
    // to infer where the bytes are from the URL. Absent on rows written
    // before this existed; `deleteAsset` falls back to the URL for those.
    iconStorage: { type: storageSchema, default: undefined },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model("BrandFeatures", brandFeaturesSchema);
