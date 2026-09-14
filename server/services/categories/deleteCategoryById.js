const Category = require("../../models/Category");
const { throwError, validateObjectId } = require("../../utils");
const { assertCategoryDeletable } = require("../../helpers/taxonomy");
const storage = require("../storage");

exports.deleteCategoryById = async (id) => {
  validateObjectId(id, "Category Id");
  const category = await Category.findById(id);
  if (!category || category.isDeleted) throwError(404, "Category not found");
  // Before the image is destroyed: the delete reaches storage and cannot be
  // undone, so a delete that is about to be refused must be refused first —
  // otherwise the category survives the 400 with its picture already gone.
  await assertCategoryDeletable(category._id);
  await storage.deleteAsset({
    url: category?.image,
    storage: category?.imageMedia?.storage,
  });
  category.isDeleted = true;
  category.isActive = false;
  category.image = null;
  category.updatedAt = new Date();
  await category.save();
  return;
};
