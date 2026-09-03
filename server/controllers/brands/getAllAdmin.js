const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllAdminBrands } = require("../../services/brands");

exports.getAllAdmin = asyncWrapper(async (req, res) => {
  const result = await getAllAdminBrands(req.query);
  return sendSuccess(res, 200, "Brands fetched successfully.", result);
});
