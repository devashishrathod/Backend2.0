const { asyncWrapper, sendSuccess } = require("../../utils");
const { reorderVoucherImages } = require("../../services/vouchers");

exports.reorderImages = asyncWrapper(async (req, res) => {
  const { versionId, ...payload } = req.validatedData;
  const result = await reorderVoucherImages(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    versionId,
    payload,
  );
  return sendSuccess(res, 200, "Voucher images reordered.", result);
});
