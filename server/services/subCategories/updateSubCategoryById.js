const SubCategory = require("../../models/SubCategory");
const { sameNameAs, toDisplayName } = require("../../helpers/common");
const Category = require("../../models/Category");
const { throwError, validateObjectId } = require("../../utils");
const storage = require("../storage");
const { assertImageFile, toMediaDocument, toDeletable } = require("../../helpers/media");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

exports.updateSubCategoryById = async (id, payload, image) => {
  validateObjectId(id, "SubCategory Id");
  const subcategory = await SubCategory.findById(id);
  if (!subcategory || subcategory.isDeleted) {
    throwError(404, "SubCategory not found");
  }
  if (payload) {
    let { name, description, categoryId, isActive } = payload;
    let category;
    if (categoryId) {
      validateObjectId(categoryId, "Category Id");
      category = await Category.findById(categoryId);
      if (!category || category.isDeleted) {
        throwError(404, "Category not found!");
      }
      subcategory.categoryId = categoryId;
    }
    if (name) {
      const existingSubCategorywithCategory = await SubCategory.findOne({
        _id: { $ne: id },
        // Case-insensitive — see `createCategory`.
        name: sameNameAs(name),
        categoryId: subcategory?.categoryId,
        isDeleted: false,
      });
      if (existingSubCategorywithCategory) {
        throwError(
          400,
          `Another Subcategory exists with this name for same category`,
        );
      }
      subcategory.name = toDisplayName(name);
    }
    if (name && categoryId) {
      const existingSubCategorywithCategory = await SubCategory.findOne({
        _id: { $ne: id },
        name: sameNameAs(name),
        categoryId,
        isDeleted: false,
      });
      if (existingSubCategorywithCategory) {
        throwError(
          400,
          `Another Subcategory exists with this name for ${category.name}`,
        );
      }
    }
    if (typeof isActive !== "undefined") {
      subcategory.isActive = !subcategory.isActive;
    }
    if (description) subcategory.description = description?.trim() || "";
  }
  assertImageFile(image, "Subcategory image");

  if (image) {
    // ⚠️ Upload first, delete second — see `updateCategoryById`. The old order
    // destroyed the existing image before the replacement had arrived.
    const previous = toDeletable(subcategory.imageMedia, subcategory.image);
    const uploaded = await storage.uploadFromPath({
      filePath: image.tempFilePath,
      originalFile: image,
      purpose: UPLOAD_PURPOSE.SUBCATEGORY_IMAGE,
      entityId: subcategory._id,
    });
    subcategory.image = uploaded.url;
    subcategory.imageMedia = toMediaDocument(uploaded);
    if (previous?.url) await storage.deleteAsset(previous);
  }
  subcategory.updatedAt = new Date();
  await subcategory.save();
  return subcategory;
};
