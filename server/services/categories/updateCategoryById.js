const Category = require("../../models/Category");
const { throwError, validateObjectId } = require("../../utils");
const storage = require("../storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

exports.updateCategoryById = async (id, payload = 0, image) => {
  validateObjectId(id, "Category Id");
  const category = await Category.findById(id);
  if (!category || category.isDeleted) throwError(404, "Category not found");
  if (payload) {
    let { name, description, isActive } = payload;
    if (typeof isActive !== "undefined") category.isActive = !category.isActive;
    if (name) {
      name = name.toLowerCase();
      const existing = await Category.findOne({
        _id: { $ne: id },
        name,
        isDeleted: false,
      });
      if (existing) throwError(400, "Another category exists with this name");
      category.name = name;
    }
    if (description) category.description = description?.toLowerCase() || "";
  }
  if (image) {
    // ⚠️ Upload first, delete second. It used to be the other way round, so a
    // failed upload left the category with its old image already destroyed and
    // nothing to replace it — a broken tile in the customer's category list,
    // from a request that answered 500 and looked recoverable.
    const previous = category.image;
    category.image = await storage.uploadUrl({
      filePath: image.tempFilePath,
      originalFile: image,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      entityId: category._id,
    });
    if (previous) await storage.deleteAsset({ url: previous });
  }
  category.updatedAt = new Date();
  await category.save();
  return category;
};
