const { asyncWrapper, sendSuccess } = require("../../utils");
const { pauseVoucher, resumeVoucher } = require("../../services/vouchers");

const actorFrom = (req) => ({
  userId: req.userId,
  role: req.role,
  brandId: req.brandId,
});

exports.pause = asyncWrapper(async (req, res) => {
  const { versionId, ...payload } = req.validatedData;
  const result = await pauseVoucher(actorFrom(req), versionId, payload);
  return sendSuccess(
    res,
    200,
    "Voucher paused. Customers will not see it until you resume it.",
    result,
  );
});

exports.resume = asyncWrapper(async (req, res) => {
  const { versionId } = req.validatedData;
  const result = await resumeVoucher(actorFrom(req), versionId);
  return sendSuccess(res, 200, "Voucher is live again.", result);
});
