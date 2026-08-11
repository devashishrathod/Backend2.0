const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllBrandFeatures } = require("../../services/brandFeatures");

exports.getAll = asyncWrapper(async (req, res) => {
  const result = await getAllBrandFeatures(req.validatedData);
  return sendSuccess(res, 200, "Brand features fetched successfully", result);
});
