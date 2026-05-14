const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const { updateSubCategoryById } = require("../../service/subCategories");
const { validateUpdateSubCategory } = require("../../validator/subCategories");

exports.updateSubCategory = asyncWrapper(async (req, res) => {
  const image = req.files?.image;
  const { error, value } = validateUpdateSubCategory(req.body);
  if (error) throwError(422, cleanJoiError(error));
  const updated = await updateSubCategoryById(req.params?.id, value, image);
  return sendSuccess(res, 200, "Sub-category updated successfully", updated);
});
