const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  getSettlements,
  getSettlementDetail,
  getSettlementTransactions,
} = require("../../services/settlements");

/**
 * The whole request goes down, not a picked-apart actor — the scope comes from
 * `req.role` and `req.brandId` together.
 */
exports.listSettlements = asyncWrapper(async (req, res) => {
  const result = await getSettlements(req, req.validatedData);
  return sendSuccess(res, 200, "Settlements fetched successfully.", result);
});

exports.settlementDetail = asyncWrapper(async (req, res) => {
  const result = await getSettlementDetail(req, req.params.settlementId);
  return sendSuccess(res, 200, "Settlement details fetched successfully.", result);
});

exports.settlementTransactions = asyncWrapper(async (req, res) => {
  const result = await getSettlementTransactions(
    req,
    req.params.settlementId,
    req.validatedData,
  );
  return sendSuccess(res, 200, "Settled payments fetched successfully.", result);
});
