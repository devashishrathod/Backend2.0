const Category = require("../../model/Category");
const { throwError, validateObjectId } = require("../../utils");
const { uploadImage, deleteImage } = require("../uploadServices");

exports.updateCategoryById = async (id, payload = {}, image) => {
  validateObjectId(id, "Category Id");
  const category = await Category.findById(id);
  if (!category || category.isDeleted) {
    throwError(404, "Category not found");
  }
  if (payload && Object.keys(payload).length) {
    let { name, type, description, isActive } = payload;
    const updatedName = name ? name.toLowerCase().trim() : category.name;
    const updatedType = type ?? category.type;
    const isNameChanged = name && updatedName !== category.name;
    const isTypeChanged =
      typeof type !== "undefined" && updatedType !== category.type;
    if (isNameChanged || isTypeChanged) {
      const conflict = await Category.findOne({
        _id: { $ne: id },
        name: updatedName,
        type: updatedType,
        isDeleted: false,
      });
      if (conflict) {
        throwError(400, "Category already exists with this name and type");
      }
    }
    if (isNameChanged) category.name = updatedName;
    if (isTypeChanged) category.type = updatedType;
    if (typeof description !== "undefined") {
      category.description = description?.toLowerCase();
    }
    if (typeof isActive !== "undefined") category.isActive = isActive;
  }
  if (image) {
    if (category.image) await deleteImage(category.image);
    const imageUrl = await uploadImage(image.tempFilePath);
    category.image = imageUrl;
  }
  category.updatedAt = new Date();
  await category.save();
  return category;
};
