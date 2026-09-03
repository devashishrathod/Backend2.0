const { asyncWrapper, sendSuccess } = require("../../utils");
const { getCustomerBrand } = require("../../services/brands");

exports.getCustomer = asyncWrapper(async (req, res) => {
  const result = await getCustomerBrand(req.validatedData);
  return sendSuccess(res, 200, "Brand details fetched successfully", result);
});
