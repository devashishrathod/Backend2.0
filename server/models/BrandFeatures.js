const mongoose = require("mongoose");
const { brandField } = require("./validObjectId");

const brandFeaturesSchema = new mongoose.Schema(
  {
    brandId: { ...brandField, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    icon: { type: String, require: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model("BrandFeatures", brandFeaturesSchema);
