const { asyncWrapper, sendSuccess } = require("../../utils");
const { previewCustomerVoucher } = require("../../services/vouchers");

exports.previewCustomerVoucher = asyncWrapper(async (req, res) => {
  const result = await previewCustomerVoucher(req.userId, req.validatedData);
  return sendSuccess(
    res,
    200,
    "Voucher preview calculated successfully.",
    result,
  );
});
