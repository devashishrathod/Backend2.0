const { asyncWrapper, sendSuccess } = require("../../utils");
const { getCustomerVouchers } = require("../../services/vouchers");

exports.getAllCustomerVouchers = asyncWrapper(async (req, res) => {
  const result = await getCustomerVouchers(req.userId, req.validatedData);
  return sendSuccess(res, 200, "Vouchers fetched successfully.", result);
});
