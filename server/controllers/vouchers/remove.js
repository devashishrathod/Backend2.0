const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteVoucher } = require("../../services/vouchers");

exports.remove = asyncWrapper(async (req, res) => {
  const { voucherId, ...payload } = req.validatedData;
  const result = await deleteVoucher(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    voucherId,
    payload,
  );
  return sendSuccess(res, 200, "Voucher deleted.", result);
});
