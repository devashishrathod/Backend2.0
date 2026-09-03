const { asyncWrapper, sendSuccess } = require("../../utils");
const { reviewTopBrand } = require("../../services/brands");

exports.reviewTopBrand = asyncWrapper(async (req, res) => {
  const result = await reviewTopBrand(
    { userId: req.userId, role: req.role },
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    result.isTopBrand
      ? "Brand added to top brands successfully."
      : "Brand removed from top brands successfully.",
    result,
  );
});
