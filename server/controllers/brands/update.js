const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateBrand } = require("../../services/brands");

exports.update = asyncWrapper(async (req, res) => {
  const brandId = req.query.brandId || req.brandId;
  const result = await updateBrand(brandId, req.validatedData, req.files?.logo);
  return sendSuccess(res, 200, "Brand details updated successfully", result);
});
