const mongoose = require("mongoose");

const Category = require("../../models/Category");
const SubCategory = require("../../models/SubCategory");
const { throwError } = require("../../utils");
const storage = require("../storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

exports.createSubCategory = async (categoryId, payload, image) => {
  const category = await Category.findById(categoryId);
  if (!category || category.isDeleted) throwError(404, "Category not found!");
  let { name, description, isActive } = payload;
  name = name?.toLowerCase();
  description = description?.toLowerCase();
  const existingSubCategory = await SubCategory.findOne({
    name: name,
    categoryId: categoryId,
    isDeleted: false,
  });
  if (existingSubCategory) {
    throwError(
      400,
      `SubCategory already exist with this name for ${category.name} category`
    );
  }
  // Minted here because the object key carries it and the upload comes first.
  const _id = new mongoose.Types.ObjectId();

  let imageUrl;
  if (image) {
    imageUrl = await storage.uploadUrl({
      filePath: image.tempFilePath,
      originalFile: image,
      purpose: UPLOAD_PURPOSE.SUBCATEGORY_IMAGE,
      entityId: _id,
    });
  }

  const newSubCategory = await SubCategory.create({
    _id,
    name,
    description,
    categoryId,
    image: imageUrl,
    isActive,
  });
  return newSubCategory;
};
