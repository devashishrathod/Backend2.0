const Category = require("../../model/Category");
const { throwError } = require("../../utils");
const { uploadImage } = require("../uploadServices");

exports.createCategory = async (payload, image) => {
  let { name, description, type, isActive } = payload;
  name = name?.toLowerCase();
  description = description?.toLowerCase();
  type = type?.toLowerCase();
  const existingCategory = await Category.findOne({
    name,
    type,
    isDeleted: false,
  });
  if (existingCategory) {
    throwError(400, "Category already exist with this name and type");
  }
  let imageUrl;
  if (image) imageUrl = await uploadImage(image.tempFilePath);
  return await Category.create({
    name,
    description,
    type,
    image: imageUrl,
    isActive,
  });
};
