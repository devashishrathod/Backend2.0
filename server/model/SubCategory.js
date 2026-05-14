const mongoose = require("mongoose");
const { DEFAULT_IMAGES, PLATFORMS } = require("../constants");
const { categoryField } = require("./validMogooseObjectId");

const subCategorySchema = new mongoose.Schema(
  {
    category: categoryField,
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    type: { type: String, enum: [...Object.values(PLATFORMS)] },
    image: { type: String, default: DEFAULT_IMAGES.SUBCATEGORY },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

subCategorySchema.index(
  { name: 1, category: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

module.exports = mongoose.model("SubCategory", subCategorySchema);
