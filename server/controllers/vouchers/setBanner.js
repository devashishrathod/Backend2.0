const { asyncWrapper, sendSuccess } = require("../../utils");
const { setVoucherBanner } = require("../../services/vouchers");
const {
  VOUCHER_BANNER_FILE_FIELD,
  VOUCHER_BANNER_POSTER_FIELD,
} = require("../../constants/voucherBanner");

exports.setBanner = asyncWrapper(async (req, res) => {
  const { voucherId } = req.validatedData;
  const result = await setVoucherBanner(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    voucherId,
    // One field name whatever the file is — the kind comes from the bytes (V-4).
    req.files?.[VOUCHER_BANNER_FILE_FIELD],
    // ⚠️ Required when the banner is a video — nothing derives a poster.
    req.files?.[VOUCHER_BANNER_POSTER_FIELD],
  );
  return sendSuccess(
    res,
    200,
    "Voucher banner submitted for review.",
    result,
  );
});
