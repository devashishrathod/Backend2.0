const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllSubBrands } = require("../../services/subBrands");

exports.getAll = asyncWrapper(async (req, res) => {
  const result = await getAllSubBrands(
    {
      userId: req.userId,
      role: req.role,
      brandId: req.brandId,
      subBrandId: req.subBrandId,
    },
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    "Outlets/Sub-Brands fetched successfully",
    result,
  );
});
