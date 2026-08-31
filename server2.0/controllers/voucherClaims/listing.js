const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  getClaimTransactions,
  getClaims,
} = require("../../services/voucherClaims");

/**
 * Both listings take the whole request, not a picked-apart actor.
 *
 * The scope is derived from `req.role`, `req.customerId`, `req.brandId` and
 * `req.subBrandId` together — and `req.customerId` is a populated document, so
 * pulling one field out here would be the start of getting it wrong.
 */
exports.listPayments = asyncWrapper(async (req, res) => {
  const result = await getClaimTransactions(req, req.validatedData);
  return sendSuccess(res, 200, "Payments fetched successfully.", result);
});

exports.listClaims = asyncWrapper(async (req, res) => {
  const result = await getClaims(req, req.validatedData);
  return sendSuccess(res, 200, "Claims fetched successfully.", result);
});
