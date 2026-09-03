const { asyncWrapper, sendSuccess } = require("../../utils");
const { reviewVoucherSuggestion } = require("../../services/vouchers");

exports.reviewSuggestion = asyncWrapper(async (req, res) => {
  const result = await reviewVoucherSuggestion(
    { userId: req.userId, role: req.role },
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    result.isSuggested
      ? "Voucher added to suggestions successfully."
      : "Voucher removed from suggestions successfully.",
    result,
  );
});
