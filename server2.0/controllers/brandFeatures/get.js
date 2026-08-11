const { asyncWrapper, sendSuccess } = require("../../utils");
const { getBrandFeature } = require("../../services/brandFeatures");

exports.get = asyncWrapper(async (req, res) => {
  const result = await getBrandFeature(req.validatedData.featureId);
  return sendSuccess(res, 200, "Brand feature fetched successfully", result);
});
