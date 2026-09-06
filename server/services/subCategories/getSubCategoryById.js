const SubCategory = require("../../models/SubCategory");
const { throwError, validateObjectId } = require("../../utils");
const { buildSubCategoryStats } = require("../../helpers/taxonomy");

exports.getSubCategoryById = async (id) => {
  validateObjectId(id, "SubCategory Id");
  const subcategory = await SubCategory.findById(id).lean();
  if (!subcategory || subcategory.isDeleted) {
    throwError(404, "SubCategory not found");
  }
  const stats = await buildSubCategoryStats([subcategory._id]);
  return { ...subcategory, stats: stats[String(subcategory._id)] };
};
