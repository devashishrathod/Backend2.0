const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  getClaimTransactionDetail,
  getClaimDetail,
} = require("../../services/voucherClaims");

/**
 * The landing page for the payment notification's deep link.
 *
 * The whole request goes down, not a picked-apart actor: the scope is derived
 * from `req.role`, `req.customerId`, `req.brandId` and `req.subBrandId`
 * together, and `req.customerId` is a populated document rather than an id.
 */
exports.paymentDetail = asyncWrapper(async (req, res) => {
  const result = await getClaimTransactionDetail(req, req.params.transactionId);
  return sendSuccess(res, 200, "Payment details fetched successfully.", result);
});

/**
 * The claim's own page, openable by id or by the code printed at the counter.
 *
 * `validateSchema` merges params into `req.validatedData`, so whichever of the
 * two the route carries arrives here under its own name.
 */
exports.claimDetail = asyncWrapper(async (req, res) => {
  const { claimId, claimCode } = req.params;
  const result = await getClaimDetail(req, { claimId, claimCode });
  return sendSuccess(res, 200, "Claim details fetched successfully.", result);
});
