const { asyncWrapper, sendSuccess } = require("../../utils");
const { submitVoucherForReview } = require("../../services/vouchers");

exports.submitForReview = asyncWrapper(async (req, res) => {
  const result = await submitVoucherForReview(req.userId, req.params.voucherId);
  return sendSuccess(
    res,
    200,
    "Voucher submitted for review successfully.",
    result,
  );
});
