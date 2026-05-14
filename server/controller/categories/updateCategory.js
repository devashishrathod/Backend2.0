const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const { updateCategoryById } = require("../../service/categories");
const { validateUpdateCategory } = require("../../validator/categories");

exports.updateCategory = asyncWrapper(async (req, res) => {
  const { error, value } = validateUpdateCategory(req.body);
  if (error) throwError(422, cleanJoiError(error));
  const image = req.files?.image;
  const updated = await updateCategoryById(req.params?.id, value, image);
  return sendSuccess(res, 200, "Category updated successfully", updated);
});
