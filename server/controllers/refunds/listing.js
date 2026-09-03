const { asyncWrapper, sendSuccess } = require("../../utils");
const { getRefunds, getRefundDetail } = require("../../services/refunds");

/**
 * The whole request goes down, not a picked-apart actor — the scope comes from
 * `req.role`, `req.customerId`, `req.brandId` and `req.subBrandId` together, and
 * `req.customerId` is a populated document.
 */
exports.listRefunds = asyncWrapper(async (req, res) => {
  const result = await getRefunds(req, req.validatedData);
  return sendSuccess(res, 200, "Refunds fetched successfully.", result);
});

exports.refundDetail = asyncWrapper(async (req, res) => {
  const result = await getRefundDetail(req, req.params.requestId);
  return sendSuccess(res, 200, "Refund details fetched successfully.", result);
});
