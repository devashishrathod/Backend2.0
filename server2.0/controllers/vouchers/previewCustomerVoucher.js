const { asyncWrapper, sendSuccess } = require("../../utils");
const { previewCustomerVoucher } = require("../../services/vouchers");

exports.previewCustomerVoucher = asyncWrapper(async (req, res) => {
  // The whole request, not `req.userId`. The builder needs `req.customerId` to
  // check the per-customer promo cap and the once-per-user offers — and that
  // field is a populated Customer *document*, so it is normalised inside rather
  // than picked apart here. A guest simply has neither, which is a supported
  // caller on this route (`optionalAuth`).
  const result = await previewCustomerVoucher(req, req.validatedData);
  return sendSuccess(
    res,
    200,
    "Voucher preview calculated successfully.",
    result,
  );
});
