const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllAdminCustomers } = require("../../services/customers");

exports.getAllAdmin = asyncWrapper(async (req, res) => {
  const result = await getAllAdminCustomers(req.query);
  return sendSuccess(res, 200, "Customers fetched successfully.", result);
});
