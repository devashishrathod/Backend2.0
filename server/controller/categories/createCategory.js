const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const { createCategory } = require("../../service/categories");
const { validateCreateCategory } = require("../../validator/categories");

exports.createCategory = asyncWrapper(async (req, res) => {
  const { error, value } = validateCreateCategory(req.body);
  if (error) throwError(422, cleanJoiError(error));
  const image = req.files?.image;
  const category = await createCategory(value, image);
  return sendSuccess(res, 201, "Category created successfully", category);
});
