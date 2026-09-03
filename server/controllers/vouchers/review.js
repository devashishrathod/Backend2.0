const { asyncWrapper, sendSuccess } = require("../../utils");
const { reviewVoucher } = require("../../services/vouchers");

exports.review = asyncWrapper(async (req, res) => {
  const result = await reviewVoucher(
    req.userId,
    req.params.versionId,
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    `Voucher ${req.validatedData.action.toLowerCase()}d successfully.`,
    result,
  );
});
