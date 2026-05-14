const {
  asyncWrapper,
  sendSuccess,
  throwError,
  validateObjectId,
  cleanJoiError,
} = require("../../utils");
const { createSubCategory } = require("../../service/subCategories");
const { validateCreateSubCategory } = require("../../validator/subCategories");

exports.createSubCategory = asyncWrapper(async (req, res) => {
  const categoryId = req.params?.categoryId;
  const image = req.files?.image;
  validateObjectId(categoryId, "category Id");
  const { error, value } = validateCreateSubCategory(req.body);
  if (error) throwError(422, cleanJoiError(error));
  const subCategory = await createSubCategory(categoryId, value, image);
  return sendSuccess(
    res,
    201,
    "Sub-category created successfully",
    subCategory
  );
});
