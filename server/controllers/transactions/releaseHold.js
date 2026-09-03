const { asyncWrapper, sendSuccess } = require("../../utils");
const { releaseTransactionHold } = require("../../services/transactions");

/**
 * Let a held payment back into the settlement run.
 *
 * The whole request goes down, not a picked-apart actor — the service checks
 * `req.role` itself and stamps `req.userId` onto the audit row, because "who
 * decided the vendor keeps this money" is the point of the record.
 */
exports.releaseHold = asyncWrapper(async (req, res) => {
  const result = await releaseTransactionHold(
    req,
    req.params.transactionId,
    req.body,
  );

  return sendSuccess(res, 200, result.message, result);
});
