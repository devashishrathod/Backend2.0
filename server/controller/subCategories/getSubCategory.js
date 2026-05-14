const { asyncWrapper, sendSuccess } = require("../../utils");
const { getSubCategoryById } = require("../../service/subCategories");

exports.getSubCategory = asyncWrapper(async (req, res) => {
  const subCategory = await getSubCategoryById(req.params?.id);
  return sendSuccess(
    res,
    200,
    "Sub-category fetched successfully",
    subCategory
  );
});
