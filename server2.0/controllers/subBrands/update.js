const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateSubBrand } = require("../../services/subBrands");

exports.update = asyncWrapper(async (req, res) => {
  const result = await updateSubBrand(req.userId,req.validatedData);
  return sendSuccess(
    res,
    200,
    "Outlet/Sub-Brand updated successfully.",
    result,
  );
});
