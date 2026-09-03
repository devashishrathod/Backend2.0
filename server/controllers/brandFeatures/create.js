const { asyncWrapper, sendSuccess } = require("../../utils");
const { addBrandFeature } = require("../../services/brandFeatures");

exports.create= asyncWrapper(async (req, res) => {
  const result = await addBrandFeature(req.validatedData, req.files?.icon);
  return sendSuccess(res, 201, "Brand feature added successfully", result);
});
