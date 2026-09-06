const Category = require("../../models/Category");
const { throwError, validateObjectId } = require("../../utils");
const { buildCategoryStats } = require("../../helpers/taxonomy");

exports.getCategoryById = async (id) => {
  validateObjectId(id, "Category Id");
  const category = await Category.findById(id).lean();
  if (!category || category.isDeleted) throwError(404, "Category not found");
  const stats = await buildCategoryStats([category._id]);
  return { ...category, stats: stats[String(category._id)] };
};
