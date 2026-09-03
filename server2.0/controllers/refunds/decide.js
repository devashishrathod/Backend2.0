const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  approveRefundAsVendor,
  rejectRefundAsVendor,
  cancelRefund,
} = require("../../services/refunds");

exports.approveRefund = asyncWrapper(async (req, res) => {
  const result = await approveRefundAsVendor(
    req,
    req.params.requestId,
    req.body,
  );
  return sendSuccess(res, 200, "Refund approved successfully.", result);
});

exports.rejectRefund = asyncWrapper(async (req, res) => {
  const result = await rejectRefundAsVendor(
    req,
    req.params.requestId,
    req.body,
  );
  return sendSuccess(res, 200, "Refund declined successfully.", result);
});

exports.withdrawRefund = asyncWrapper(async (req, res) => {
  const result = await cancelRefund(req, req.params.requestId);
  return sendSuccess(
    res,
    200,
    "Refund request withdrawn successfully.",
    result,
  );
});
