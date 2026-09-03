const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  requestBankDetails,
  attachBankToRefund,
  payRefundToBank,
  confirmRefundPayout,
  failRefundPayout,
} = require("../../services/refunds");

/** Admin: `SOURCE` failed — ask the customer where to send the money instead. */
exports.requestRefundBankDetails = asyncWrapper(async (req, res) => {
  const result = await requestBankDetails(req, req.params.requestId, req.body);
  return sendSuccess(
    res,
    200,
    "The customer has been asked for their bank account.",
    result,
  );
});

/** Customer: pick which of their verified accounts this refund goes to. */
exports.chooseRefundBankAccount = asyncWrapper(async (req, res) => {
  const result = await attachBankToRefund(req, req.params.requestId, req.body);
  return sendSuccess(
    res,
    200,
    "Bank account added to your refund. We will transfer it shortly.",
    result,
  );
});

/** Admin: open the payout leg. The NEFT itself is done by hand. */
exports.payRefundToBankAccount = asyncWrapper(async (req, res) => {
  const result = await payRefundToBank(req, req.params.requestId);
  return sendSuccess(
    res,
    200,
    "Payout started. Make the transfer, then confirm it with the UTR.",
    result,
  );
});

/** Admin: the transfer landed — the UTR is what makes it real. */
exports.confirmRefundBankPayout = asyncWrapper(async (req, res) => {
  const result = await confirmRefundPayout(req, req.params.requestId, req.body);
  return sendSuccess(res, 200, "Refund confirmed and closed.", result);
});

/** Admin: the transfer bounced. The leg is kept; a retry opens a new one. */
exports.failRefundBankPayout = asyncWrapper(async (req, res) => {
  const result = await failRefundPayout(req, req.params.requestId, req.body);
  return sendSuccess(res, 200, "Payout marked as failed.", result);
});
