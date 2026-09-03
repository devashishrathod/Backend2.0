const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteVoucherBanner } = require("../../services/vouchers");

exports.deleteBanner = asyncWrapper(async (req, res) => {
  await deleteVoucherBanner(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData.voucherId,
  );
  return sendSuccess(res, 200, "Voucher banner deleted successfully.");
});
