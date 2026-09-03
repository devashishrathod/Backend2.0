const { asyncWrapper, sendSuccess } = require("../../utils");
const { getCustomerSingleVoucher } = require("../../services/vouchers");

exports.getCustomerVoucher = asyncWrapper(async (req, res) => {
  const result = await getCustomerSingleVoucher(req.userId, req.validatedData);
  return sendSuccess(res, 200, "Voucher fetched successfully.", result);
});
