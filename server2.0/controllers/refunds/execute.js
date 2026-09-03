const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  approveRefundAsAdmin,
  rejectRefundAsAdmin,
  executeRefund,
} = require("../../services/refunds");

exports.adminApproveRefund = asyncWrapper(async (req, res) => {
  const result = await approveRefundAsAdmin(
    req,
    req.params.requestId,
    req.body,
  );
  return sendSuccess(res, 200, "Refund approved successfully.", result);
});

exports.adminRejectRefund = asyncWrapper(async (req, res) => {
  const result = await rejectRefundAsAdmin(req, req.params.requestId, req.body);
  return sendSuccess(res, 200, "Refund declined successfully.", result);
});

exports.payRefund = asyncWrapper(async (req, res) => {
  const result = await executeRefund(req, req.params.requestId);
  return sendSuccess(
    res,
    200,
    result.recovered
      ? // An honest message: nothing new was sent, an earlier attempt had already
        // reached Razorpay and this run adopted it.
        "This refund had already reached Razorpay; it is now linked and processing."
      : "Refund sent to Razorpay successfully.",
    result,
  );
});
