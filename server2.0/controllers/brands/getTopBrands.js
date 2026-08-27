const { asyncWrapper, sendSuccess } = require("../../utils");
const { getTopBrands } = require("../../services/brands");

exports.getTopBrands = asyncWrapper(async (req, res) => {
  const result = await getTopBrands(req.validatedData);
  return sendSuccess(res, 200, "Top brands fetched successfully.", result);
});
