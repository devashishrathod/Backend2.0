const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllCustomerBrands } = require("../../services/brands");

exports.getAllCustomer = asyncWrapper(async (req, res) => {
  const result = await getAllCustomerBrands(req.validatedData);
  return sendSuccess(res, 200, "Brands fetched successfully", result);
});
