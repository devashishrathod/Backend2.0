const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateBrandFeature } = require("../../services/brandFeatures");

exports.update = asyncWrapper(async (req, res) => {
  const result = await updateBrandFeature(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
    req.files?.icon,
  );

  return sendSuccess(res, 200, "Brand feature updated successfully", result);
});
