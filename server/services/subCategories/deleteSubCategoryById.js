const SubCategory = require("../../models/SubCategory");
const { throwError, validateObjectId } = require("../../utils");
const { assertSubCategoryDeletable } = require("../../helpers/taxonomy");
const storage = require("../storage");

exports.deleteSubCategoryById = async (id) => {
  validateObjectId(id, "SubCategory Id");
  const subCategory = await SubCategory.findById(id);
  if (!subCategory || subCategory.isDeleted) {
    throwError(404, "subCategory not found");
  }
  // Refuse before touching storage — see deleteCategoryById.
  await assertSubCategoryDeletable(subCategory._id);
  await storage.deleteAsset({
    url: subCategory?.image,
    storage: subCategory?.imageStorage,
  });
  subCategory.image = null;
  subCategory.isDeleted = true;
  subCategory.isActive = false;
  subCategory.updatedAt = new Date();
  await subCategory.save();
  return;
};
