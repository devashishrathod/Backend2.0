const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateSubBrand } = require("../../services/subBrands");

exports.update = asyncWrapper(async (req, res) => {
  const result = await updateSubBrand(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    result.outletTypeChanged
      ? "Outlet/Sub-Brand updated and outlet type switched successfully."
      : "Outlet/Sub-Brand updated successfully.",
    result,
  );
});
