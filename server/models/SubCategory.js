const mongoose = require("mongoose");
const { storageSchema } = require("./storageSchema");
const { DEFAULT_IMAGES } = require("../constants");
const { categoryField } = require("./validObjectId");

const subCategorySchema = new mongoose.Schema(
  {
    categoryId: categoryField,
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    image: { type: String, default: DEFAULT_IMAGES.SUBCATEGORY },
    // Sibling of the field above — provider + key, so a delete does not have
    // to infer where the bytes are from the URL. Absent on rows written
    // before this existed; `deleteAsset` falls back to the URL for those.
    imageStorage: { type: storageSchema, default: undefined },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

// Powers the `stats.subCategories` count on the category listing, and the
// filter behind `GET /subCategories/getAll?categoryId=`.
subCategorySchema.index({ categoryId: 1, isDeleted: 1 });

module.exports = mongoose.model("SubCategory", subCategorySchema);
