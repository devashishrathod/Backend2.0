const { asyncWrapper, sendSuccess } = require("../../utils");
const { reviewVoucherBanner } = require("../../services/vouchers");
const { VOUCHER_BANNER_STATUS } = require("../../constants/voucherBanner");

exports.reviewBanner = asyncWrapper(async (req, res) => {
  const { voucherId, ...payload } = req.validatedData;
  const result = await reviewVoucherBanner(req.userId, voucherId, payload);
  /**
   * ⚠️ The message comes from the **action**, not from the resulting status.
   * Approval deliberately leaves `banner.status` as `null` (nothing is in review
   * any more), so reading the outcome back would have to spell approval as
   * "not rejected" — true today only because those are the only two endings.
   */
  const rejected = payload.action === VOUCHER_BANNER_STATUS.REJECTED;
  return sendSuccess(
    res,
    200,
    `Voucher banner ${rejected ? "rejected" : "approved"}.`,
    result,
  );
});
