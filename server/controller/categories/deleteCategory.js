const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteCategoryById } = require("../../service/categories");

exports.deleteCategory = asyncWrapper(async (req, res) => {
  await deleteCategoryById(req.params?.id);
  return sendSuccess(res, 200, "Category deleted successfully");
});
