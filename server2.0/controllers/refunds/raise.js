const { asyncWrapper, sendSuccess } = require("../../utils");
const { requestRefund } = require("../../services/refunds");

/**
 * The whole request goes down, not a picked-apart actor — `req.customerId` is a
 * populated document, so pulling one field out here is the start of getting it
 * wrong.
 */
exports.raiseRefund = asyncWrapper(async (req, res) => {
  const result = await requestRefund(req, req.validatedData);
  return sendSuccess(res, 201, "Refund request raised successfully.", result);
});
