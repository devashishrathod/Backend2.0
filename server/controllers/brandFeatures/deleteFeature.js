const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteBrandFeature } = require("../../services/brandFeatures");

exports.deleteFeature = asyncWrapper(async (req, res) => {
  const result = await deleteBrandFeature(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData.featureId,
  );
  return sendSuccess(res, 200, "Brand feature deleted successfully", result);
});
