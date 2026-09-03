const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAdminCustomerDetail } = require("../../services/customers");

exports.getAdmin = asyncWrapper(async (req, res) => {
  const result = await getAdminCustomerDetail(req.params.customerId, req.query);
  return sendSuccess(res, 200, "Customer fetched successfully.", result);
});
