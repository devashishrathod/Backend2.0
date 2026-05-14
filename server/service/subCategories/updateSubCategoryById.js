const SubCategory = require("../../model/SubCategory");
const Category = require("../../model/Category");
const { throwError, validateObjectId } = require("../../utils");
const { uploadImage, deleteImage } = require("../uploadServices");

exports.updateSubCategoryById = async (id, payload = {}, image) => {
  validateObjectId(id, "SubCategory Id");
  const subcategory = await SubCategory.findById(id);
  if (!subcategory || subcategory.isDeleted) {
    throwError(404, "SubCategory not found");
  }
  if (payload && Object.keys(payload).length) {
    let { name, description, categoryId, isActive } = payload;
    const finalName = name ? name.toLowerCase() : subcategory.name;
    const finalCategoryId = categoryId ? categoryId : subcategory.category;
    let category;
    if (categoryId) {
      validateObjectId(categoryId, "Category Id");
      category = await Category.findById(categoryId);
      if (!category || category.isDeleted) {
        throwError(404, "Category not found");
      }
      subcategory.category = categoryId;
      subcategory.type = category.type;
    }
    if (name || categoryId) {
      const existingSubCategory = await SubCategory.findOne({
        _id: { $ne: id },
        name: finalName,
        category: finalCategoryId,
        isDeleted: false,
      });
      if (existingSubCategory) {
        throwError(
          400,
          `SubCategory already exists with this name for ${
            category?.name || "this"
          } category`
        );
      }
    }
    if (name) subcategory.name = finalName;
    if (description) subcategory.description = description.toLowerCase();
    if (typeof isActive !== "undefined") subcategory.isActive = isActive;
  }
  if (image) {
    if (subcategory.image) await deleteImage(subcategory.image);
    subcategory.image = await uploadImage(image.tempFilePath);
  }
  subcategory.updatedAt = new Date();
  await subcategory.save();
  return subcategory;
};
