const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateBrandFeature } = require("../../services/brandFeatures");

exports.update = asyncWrapper(async (req, res) => {
  const result = await updateBrandFeature(req.validatedData, req.files?.icon);

  return sendSuccess(res, 200, "Brand feature updated successfully", result);
});
