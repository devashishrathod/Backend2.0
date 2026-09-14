const { asyncWrapper, sendSuccess } = require("../../utils");
const { publishVoucher } = require("../../services/vouchers");

exports.publish = asyncWrapper(async (req, res) => {
  const result = await publishVoucher(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.params.versionId,
  );
  return sendSuccess(res, 200, "Voucher published successfully.", result);
});
