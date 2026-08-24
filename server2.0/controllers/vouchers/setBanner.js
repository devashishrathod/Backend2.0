const { asyncWrapper, sendSuccess } = require("../../utils");
const { setVoucherBanner } = require("../../services/vouchers");
const { VOUCHER_BANNER_FILE_FIELD } = require("../../constants/voucherBanner");

exports.setBanner = asyncWrapper(async (req, res) => {
  const { voucherId, bannerType } = req.validatedData;
  const file = req.files?.[VOUCHER_BANNER_FILE_FIELD[bannerType]];
  const result = await setVoucherBanner(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    voucherId,
    bannerType,
    file,
  );
  return sendSuccess(res, 200, "Voucher banner saved successfully.", result);
});
