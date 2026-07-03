const { asyncWrapper, sendSuccess } = require("../../utils");
const { getBrand } = require("../../services/brands");

exports.get = asyncWrapper(async (req, res) => {
  const brandId = req.query.brandId || req.brandId;
  const result = await getBrand(brandId);
  return sendSuccess(res, 200, "Brand details fetched successfully", result);
});
