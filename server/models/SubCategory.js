const mongoose = require("mongoose");
const { DEFAULT_IMAGES } = require("../constants");
const { categoryField } = require("./validObjectId");

const subCategorySchema = new mongoose.Schema(
  {
    categoryId: categoryField,
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    image: { type: String, default: DEFAULT_IMAGES.SUBCATEGORY },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

// Powers the `stats.subCategories` count on the category listing, and the
// filter behind `GET /subCategories/getAll?categoryId=`.
subCategorySchema.index({ categoryId: 1, isDeleted: 1 });

module.exports = mongoose.model("SubCategory", subCategorySchema);
