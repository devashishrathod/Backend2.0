const Category = require("../../model/Category");
const SubCategory = require("../../model/SubCategory");
const { throwError } = require("../../utils");
const { uploadImage } = require("../uploadServices");

exports.createSubCategory = async (categoryId, payload, image) => {
  const category = await Category.findById(categoryId);
  if (!category || category.isDeleted) throwError(404, "Category not found!");
  let { name, description, isActive } = payload;
  name = name?.toLowerCase();
  description = description?.toLowerCase();
  const existingSubCategory = await SubCategory.findOne({
    name,
    category: categoryId,
    isDeleted: false,
  });
  if (existingSubCategory) {
    throwError(
      400,
      `SubCategory already exist with this name for ${category.name} category`
    );
  }
  let imageUrl;
  if (image) imageUrl = await uploadImage(image.tempFilePath);
  return await SubCategory.create({
    name,
    description,
    type: category?.type,
    category: categoryId,
    image: imageUrl,
    isActive,
  });
};
